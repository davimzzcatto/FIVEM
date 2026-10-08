import { graph } from './publishers/graph.js';
import { PublishError, networkError } from './publishers/errors.js';

const DAY = 86_400_000;

// Login nas redes: monta a URL de autorização, troca o código por tokens e renova tokens.
export function createOAuth({ config, fetch, now = Date.now }) {
  const v = config.graphVersion;
  const redirect = (platform) => `${config.publicUrl}/oauth/${platform}/callback`;

  async function form(url, params) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw networkError(err);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error || body.error_type) {
      const msg = body.error_description || body.error_message || body.error?.message || body.message || `HTTP ${res.status}`;
      throw new PublishError(msg, { auth: true });
    }
    return body;
  }

  const instagram = {
    scopes: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments'],
    authorizeUrl(state) {
      const u = new URL('https://www.instagram.com/oauth/authorize');
      u.search = new URLSearchParams({
        enable_fb_login: '0',
        force_authentication: '1',
        client_id: config.instagram.appId,
        redirect_uri: redirect('instagram'),
        response_type: 'code',
        scope: this.scopes.join(','),
        state,
      });
      return u.toString();
    },
    async exchange(code) {
      const short = await form('https://api.instagram.com/oauth/access_token', {
        client_id: config.instagram.appId,
        client_secret: config.instagram.appSecret,
        grant_type: 'authorization_code',
        redirect_uri: redirect('instagram'),
        code: code.replace(/#_$/, ''),
      });
      const shortToken = short.access_token || short.data?.[0]?.access_token;
      const long = await graph(fetch, 'GET', 'https://graph.instagram.com/access_token', {
        grant_type: 'ig_exchange_token',
        client_secret: config.instagram.appSecret,
        access_token: shortToken,
      });
      const me = await graph(fetch, 'GET', `https://graph.instagram.com/${v}/me`, {
        fields: 'user_id,username,name,profile_picture_url,account_type',
        access_token: long.access_token,
      });
      return [
        {
          platform: 'instagram',
          external_id: String(me.user_id || me.id),
          username: me.username,
          display_name: me.name || me.username,
          avatar_url: me.profile_picture_url || null,
          access_token: long.access_token,
          token_expires_at: now() + (long.expires_in || 60 * 86_400) * 1000,
        },
      ];
    },
    // Tokens longos do Instagram valem 60 dias e só podem ser renovados depois de 24h de vida.
    needsRefresh(acc) {
      return acc.token_expires_at && acc.token_expires_at - now() < 15 * DAY && now() - (acc.token_issued_at || 0) > DAY;
    },
    async refresh(acc) {
      const r = await graph(fetch, 'GET', 'https://graph.instagram.com/refresh_access_token', { grant_type: 'ig_refresh_token', access_token: acc.accessToken });
      return { access_token: r.access_token, token_expires_at: now() + (r.expires_in || 60 * 86_400) * 1000 };
    },
  };

  const facebook = {
    scopes: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'business_management'],
    authorizeUrl(state) {
      const u = new URL(`https://www.facebook.com/${v}/dialog/oauth`);
      u.search = new URLSearchParams({ client_id: config.facebook.appId, redirect_uri: redirect('facebook'), state, scope: this.scopes.join(','), response_type: 'code' });
      return u.toString();
    },
    // Devolve as Páginas da pessoa; quem chama escolhe quais viram contas.
    async exchange(code) {
      const short = await graph(fetch, 'GET', `https://graph.facebook.com/${v}/oauth/access_token`, {
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        redirect_uri: redirect('facebook'),
        code,
      });
      const long = await graph(fetch, 'GET', `https://graph.facebook.com/${v}/oauth/access_token`, {
        grant_type: 'fb_exchange_token',
        client_id: config.facebook.appId,
        client_secret: config.facebook.appSecret,
        fb_exchange_token: short.access_token,
      });
      const pages = [];
      let next = `https://graph.facebook.com/${v}/me/accounts`;
      let params = { fields: 'id,name,access_token,picture{url},tasks', limit: 100, access_token: long.access_token };
      while (next && pages.length < 500) {
        const r = await graph(fetch, 'GET', next, params);
        pages.push(...(r.data || []));
        next = r.paging?.next || null;
        params = {};
      }
      // Token de Página gerado a partir de token longo de usuário não expira.
      return pages
        .filter((p) => !p.tasks || p.tasks.includes('CREATE_CONTENT'))
        .map((p) => ({
          platform: 'facebook',
          external_id: String(p.id),
          username: p.name,
          display_name: p.name,
          avatar_url: p.picture?.data?.url || null,
          access_token: p.access_token,
          token_expires_at: null,
        }));
    },
    needsRefresh: () => false,
  };

  const tiktok = {
    scopes: ['user.info.basic', 'video.publish', 'video.upload'],
    authorizeUrl(state) {
      const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
      u.search = new URLSearchParams({ client_key: config.tiktok.clientKey, scope: this.scopes.join(','), response_type: 'code', redirect_uri: redirect('tiktok'), state });
      return u.toString();
    },
    async exchange(code) {
      const t = await form('https://open.tiktokapis.com/v2/oauth/token/', {
        client_key: config.tiktok.clientKey,
        client_secret: config.tiktok.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirect('tiktok'),
      });
      let user = {};
      try {
        const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username', {
          headers: { Authorization: `Bearer ${t.access_token}` },
          signal: AbortSignal.timeout(30_000),
        });
        user = (await res.json()).data?.user || {};
      } catch {
        /* perfil é opcional; segue com o open_id */
      }
      return [
        {
          platform: 'tiktok',
          external_id: String(t.open_id),
          username: user.username || user.display_name || `tiktok_${String(t.open_id).slice(0, 6)}`,
          display_name: user.display_name || user.username || 'TikTok',
          avatar_url: user.avatar_url || null,
          access_token: t.access_token,
          refresh_token: t.refresh_token,
          token_expires_at: now() + (t.expires_in || 86_400) * 1000,
          refresh_expires_at: now() + (t.refresh_expires_in || 365 * 86_400) * 1000,
        },
      ];
    },
    // O token de acesso do TikTok dura 24h; renova sempre que faltar menos de 1h.
    needsRefresh(acc) {
      return acc.token_expires_at && acc.token_expires_at - now() < 3_600_000;
    },
    async refresh(acc) {
      const t = await form('https://open.tiktokapis.com/v2/oauth/token/', {
        client_key: config.tiktok.clientKey,
        client_secret: config.tiktok.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: acc.refreshToken,
      });
      return {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        token_expires_at: now() + (t.expires_in || 86_400) * 1000,
        refresh_expires_at: now() + (t.refresh_expires_in || 365 * 86_400) * 1000,
      };
    },
  };

  return { instagram, facebook, tiktok, redirect };
}
