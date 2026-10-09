import { createInstagramPublisher } from './instagram.js';
import { createFacebookPublisher } from './facebook.js';
import { createTiktokPublisher } from './tiktok.js';
import { createSimulatorPublisher } from './simulator.js';

export { PublishError } from './errors.js';

export function createPublishers({ config }) {
  const live = {
    instagram: createInstagramPublisher({ config }),
    facebook: createFacebookPublisher({ config }),
    tiktok: createTiktokPublisher({ config }),
  };
  const simulator = createSimulatorPublisher({ config });
  return {
    for(account) {
      return account.mode === 'simulated' ? simulator : live[account.platform];
    },
  };
}
