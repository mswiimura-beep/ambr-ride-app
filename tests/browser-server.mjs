import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const mock = `<script>
window.supabase={createClient(){
  const empty=()=>{const chain={select:()=>chain,insert:()=>chain,upsert:()=>chain,update:()=>chain,delete:()=>chain,order:()=>chain,limit:()=>chain,in:()=>chain,eq:()=>chain,gte:()=>chain,lt:()=>chain,maybeSingle:()=>Promise.resolve({data:null,error:null}),single:()=>Promise.resolve({data:{id:'test-id'},error:null}),then:(resolve)=>Promise.resolve({data:[],error:null}).then(resolve)};return chain};
  return {auth:{getSession:async()=>({data:{session:{access_token:'source-token',refresh_token:'source-refresh',user:{id:'test-user',is_anonymous:true}}},error:null}),signInAnonymously:async()=>({data:{user:{id:'test-user',is_anonymous:true}},error:null}),updateUser:async()=>({data:{user:{id:'test-user'}},error:null}),signInWithOtp:async()=>({data:{},error:null}),verifyOtp:async()=>({data:{session:{access_token:'target-token',refresh_token:'target-refresh'}},error:null}),setSession:async()=>({data:{user:{id:'target-user',is_anonymous:false}},error:null}),onAuthStateChange(callback){queueMicrotask(()=>callback('INITIAL_SESSION',{user:{id:'test-user',is_anonymous:true}}));return {data:{subscription:{unsubscribe(){}}}}}},from:empty,storage:{from:()=>({createSignedUrls:async()=>({data:[],error:null}),upload:async()=>({data:{},error:null}),remove:async()=>({data:{},error:null})})},functions:{invoke:async()=>({data:null,error:{message:'disabled in browser test'}})}};
}};
</script>`;
const html = source
  .replace(/<script src="https:\/\/unpkg\.com\/leaflet[^>]+><\/script>/, '')
  .replace(/<script src="https:\/\/unpkg\.com\/maplibre[^>]+><\/script>/, '')
  .replace(/<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase[^>]+><\/script>/, mock);

const server = createServer((request, response) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
  if (pathname === '/' || pathname === '/index.html') {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'});
    response.end(html);
    return;
  }
  response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
  response.end('not found');
});

server.listen(4173, '127.0.0.1', () => {
  console.log('AMBR browser smoke-test server: http://127.0.0.1:4173/');
});
