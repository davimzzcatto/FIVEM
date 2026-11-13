// Gera curriculo/davi-mazzucatto-curriculo.pdf a partir de curriculo/curriculo.html (A4, texto selecionável).
// Uso: node curriculo/gerar-pdf.js   — depois rode python3 build.py para levar o PDF ao dist/.
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto("file://" + path.join(__dirname, "curriculo.html"), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const saida = path.join(__dirname, "davi-mazzucatto-curriculo.pdf");
  await page.pdf({ path: saida, preferCSSPageSize: true, printBackground: true });
  await browser.close();
  console.log("PDF gerado:", saida);
})();
