import { LIVE_ONLY_DEFAULTS } from './liveOnly';

export function landingTemplate(manifest: any): string {
  const defaults: Record<string, string> = {};
  for (const field of manifest.config || []) {
    if (['mediaFlowProxyUrl', 'mediaFlowProxyPassword'].includes(field.key) && typeof field.default === 'string') {
      defaults[field.key] = field.default;
    }
  }
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StreamViX Live · Configurazione</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#141021;color:#f5f3ff;font:17px/1.5 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{width:100%;max-width:560px;background:#211832;border:1px solid #554074;border-radius:22px;padding:32px}h1{margin:0;font-size:32px}p{color:#c8bed9}label{display:block;margin:22px 0 8px;font-weight:600}
input,button,a{font:inherit}input{width:100%;padding:13px;border:1px solid #74618e;border-radius:10px;background:#151020;color:#fff}input:focus{outline:2px solid #b995ff;outline-offset:2px}
button,.install{display:block;width:100%;padding:13px 16px;border:0;border-radius:10px;cursor:pointer;text-align:center;text-decoration:none;font-weight:650}button{background:#a87af5;color:#160b27;margin-top:24px}.install{background:#a87af5;color:#160b27;margin:18px 0 10px}.secondary{background:#392a50;color:#fff;margin-top:10px}
small{display:block;color:#bbaeca;margin-top:8px}#error{color:#ffb4b4}#result[hidden]{display:none}#result{border-top:1px solid #554074;margin-top:26px;padding-top:8px}#manifest{font-size:13px}button:focus-visible,a:focus-visible{outline:2px solid #fff;outline-offset:3px}
footer{border-top:1px solid #554074;margin-top:28px;padding-top:18px;font-size:14px;color:#bbaeca}footer a{color:#cfb2ff;text-underline-offset:3px}footer p{margin:6px 0}
</style></head><body><main>
<h1>StreamViX Live</h1><p>Solo eventi sportivi e sorgenti live. Inserisci il tuo EasyProxy per iniziare.</p>
<form id="config-form">
<label for="proxy">URL EasyProxy</label><input id="proxy" type="url" placeholder="https://proxy.example.org" autocomplete="url" required>
<label for="password">Password EasyProxy</label><input id="password" type="password" autocomplete="off" placeholder="Password del proxy">
<small>Inserisci solo la password, senza parametri del link.</small>
<button type="submit">Genera installazione</button><p id="error" role="alert"></p>
</form>
<section id="result" hidden><a id="install" class="install">Installa in Stremio</a>
<label for="manifest">Link del manifest</label><input id="manifest" readonly>
<button id="copy" class="secondary" type="button">Copia link</button><small id="copy-status" role="status"></small>
<small>Il link contiene la configurazione del proxy: conservalo per uso personale.</small></section>
<footer aria-label="Crediti">
<p>Basato su <a href="https://github.com/qwertyuiop8899/streamvix" target="_blank" rel="noopener noreferrer">StreamViX</a>, progetto originale di <a href="https://github.com/qwertyuiop8899" target="_blank" rel="noopener noreferrer">qwertyuiop8899</a> e dei suoi collaboratori.</p>
<p>Questa versione dedicata agli eventi live</p>
</footer>
</main><script>
const defaults=${json(defaults)};
const liveDefaults=${json(LIVE_ONLY_DEFAULTS)};
const proxy=document.getElementById('proxy'),password=document.getElementById('password');
proxy.value=defaults.mediaFlowProxyUrl||'';password.value=defaults.mediaFlowProxyPassword||'';
const result=document.getElementById('result');
for(const input of [proxy,password]) input.addEventListener('input',()=>{result.hidden=true;});
document.getElementById('config-form').addEventListener('submit',function(event){
 event.preventDefault();const error=document.getElementById('error');error.textContent='';
 try{
  const url=new URL(proxy.value.trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error('Inserisci l’URL base di EasyProxy, senza password o parametri.');
  const config={...liveDefaults,mediaFlowProxyUrl:url.href.replace(/\\/+$/,''),mediaFlowProxyPassword:password.value};
  const bytes=new TextEncoder().encode(JSON.stringify(config));
  const encoded=btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  const path='/'+encoded+'/manifest.json';
  document.getElementById('manifest').value=location.origin+path;
  document.getElementById('install').href='stremio://'+location.host+path;
  document.getElementById('copy-status').textContent='';result.hidden=false;
 }catch(e){error.textContent=e.message||'Controlla l’URL del proxy.';}
});
document.getElementById('copy').addEventListener('click',async function(){
 const input=document.getElementById('manifest');
 try{await navigator.clipboard.writeText(input.value);document.getElementById('copy-status').textContent='Link copiato.';}
 catch(e){input.focus();input.select();document.getElementById('copy-status').textContent='Premi Ctrl+C per copiare il link.';}
});
</script></body></html>`;
}
