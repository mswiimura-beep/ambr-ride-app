(function(){
  'use strict';
  const SUPABASE_URL='https://hfilysmmzvbuqypnxqai.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_GupuLZDB109jlEpxtfuiEQ_l6wxvTpd';
  const client=window.supabase?.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
  let session=null,authSignup=false,photoFilter='mine',selectedMemberId='',members=[],photoPageSize=30,photoVisible=30;
  const localOpenPhotoPost=window.openPhotoPost;
  const localSavePhotoPost=window.savePhotoPost;
  const localDeletePhotoPost=window.deletePhotoPost;
  const localRenderPhotoPosts=window.renderPhotoPosts;
  const localSavePlannedRoute=window.savePlannedRoute,localDeletePlannedRoute=window.deletePlannedRoute;

  function authError(message){const el=document.getElementById('memberAuthError');el.textContent=message||'';el.classList.toggle('show',!!message)}
  window.openMemberAuth=function(){
    if(session){if(confirm('メンバーログインを解除しますか？'))client.auth.signOut();return}
    authSignup=false;syncAuthMode();authError('');document.getElementById('memberAuthModal').classList.add('open');
  };
  window.closeMemberAuth=function(){document.getElementById('memberAuthModal').classList.remove('open')};
  window.toggleMemberAuthMode=function(){authSignup=!authSignup;syncAuthMode();authError('')};
  function syncAuthMode(){
    document.getElementById('memberAuthTitle').textContent=authSignup?'メンバー登録':'メンバーログイン';
    document.getElementById('memberNameLabel').style.display=authSignup?'grid':'none';
    document.getElementById('memberAuthSubmit').textContent=authSignup?'登録する':'ログイン';
    document.getElementById('memberAuthSwitch').textContent=authSignup?'登録済みの方：ログイン':'初めての方：メンバー登録';
  }
  window.submitMemberAuth=async function(){
    if(!client)return authError('オンライン接続を読み込めませんでした。通信状態を確認してください。');
    const email=document.getElementById('memberEmail').value.trim(),password=document.getElementById('memberPassword').value,name=document.getElementById('memberDisplayName').value.trim();
    if(!email||password.length<6||(authSignup&&!name))return authError(authSignup?'表示名・メール・6文字以上のパスワードを入力してください。':'メールと6文字以上のパスワードを入力してください。');
    const button=document.getElementById('memberAuthSubmit');button.disabled=true;button.textContent='確認しています…';authError('');
    try{
      const result=authSignup?await client.auth.signUp({email,password,options:{data:{display_name:name}}}):await client.auth.signInWithPassword({email,password});
      if(result.error)throw result.error;
      if(authSignup&&!result.data.session){authError('確認メールを送りました。メール内のリンクを開いてからログインしてください。');return}
      closeMemberAuth();showToast(authSignup?'メンバー登録が完了しました':'ログインしました');
    }catch(error){authError(toJapaneseAuthError(error.message))}finally{button.disabled=false;syncAuthMode()}
  };
  function toJapaneseAuthError(message){
    if(/invalid login credentials/i.test(message))return 'メールアドレスまたはパスワードが違います。';
    if(/already registered/i.test(message))return 'このメールアドレスは登録済みです。';
    if(/email rate limit/i.test(message))return '確認メールの送信回数が多すぎます。少し待って再度お試しください。';
    return '処理できませんでした。入力内容と通信状態を確認してください。';
  }
  async function refreshSession(nextSession){
    session=nextSession;const status=document.getElementById('shareStatus'),button=document.getElementById('shareAuthButton'),filter=document.getElementById('memberFilter');
    status.classList.toggle('online',!!session);filter.classList.toggle('show',!!session);button.textContent=session?'ログアウト':'ログイン';
    document.getElementById('shareStatusTitle').textContent=session?'オンライン共有中':'端末内モード';
    document.getElementById('shareStatusText').textContent=session?(session.user.user_metadata?.display_name||session.user.email)+' としてログイン中':'ログインするとメンバーと共有できます';
    const action=document.querySelector('.photo-actions'),postSummary=document.querySelector('#photoPostModal .summary'),saveButton=document.querySelector('#photoPostModal .close');
    if(action){action.querySelector('h4').textContent=session?'写真をメンバーと共有':'写真を追加する';action.querySelector('p').textContent=session?'写真はメンバー共通のオンライン保存場所に保存します。場所は許可した写真だけ地図に表示されます。':'写真はこの端末だけに保存されています。ログインするとメンバーと共有できます。';action.querySelector('button').textContent=session?'＋ 共有する写真を選ぶ':'＋ ログインして写真を共有'}
    if(postSummary)postSummary.textContent=session?'写真と投稿内容は登録メンバーだけに共有されます。':'写真と投稿内容はこの端末内だけに保存されます。';if(saveButton)saveButton.textContent=session?'メンバーと写真を共有':'この端末に写真を保存';
    if(session){await retryPhotoCleanup();await loadMembers();await syncSharedRoutes()}else{members=[];photoFilter='mine';document.getElementById('memberPicker').classList.remove('show')}
    await window.renderPhotoPosts();
  }
  async function loadMembers(){
    const {data,error}=await client.from('profiles').select('id,display_name').order('display_name');if(error){members=[];return}
    members=data||[];const picker=document.getElementById('memberPicker');picker.replaceChildren();members.forEach(member=>{const option=document.createElement('option');option.value=member.id;option.textContent=member.display_name+(member.id===session.user.id?'（自分）':'');picker.append(option)});
    if(!selectedMemberId||!members.some(m=>m.id===selectedMemberId))selectedMemberId=members.find(m=>m.id!==session.user.id)?.id||session.user.id;picker.value=selectedMemberId;
  }
  window.setPhotoFilter=function(filter,button){photoFilter=filter;photoVisible=photoPageSize;document.querySelectorAll('[data-photo-filter]').forEach(el=>el.classList.toggle('active',el===button));document.getElementById('memberPicker').classList.toggle('show',filter==='member');window.renderPhotoPosts()};
  window.selectPhotoMember=function(id){selectedMemberId=id;photoVisible=photoPageSize;window.renderPhotoPosts()};
  window.loadMorePhotos=function(){photoVisible+=photoPageSize;window.renderPhotoPosts()};
  async function retryPhotoCleanup(){try{const key='ambr-photo-cleanup-v1',paths=JSON.parse(localStorage.getItem(key)||'[]');if(!Array.isArray(paths)||!paths.length)return;const result=await client.storage.from('ride-photos').remove(paths);if(!result.error)localStorage.removeItem(key)}catch(e){}}
  function queuePhotoCleanup(paths){try{const key='ambr-photo-cleanup-v1',old=JSON.parse(localStorage.getItem(key)||'[]'),all=[...new Set([...(Array.isArray(old)?old:[]),...paths])];localStorage.setItem(key,JSON.stringify(all))}catch(e){}}
  async function syncSharedRoutes(){
    const {data,error}=await client.from('planned_routes').select('*').order('created_at',{ascending:false});if(error)return;
    const local=getPlannedRoutes().filter(route=>!route.onlineShared),remote=(data||[]).map(row=>({id:'online-'+row.id,onlineId:row.id,onlineShared:true,ownerId:row.user_id,name:row.name,scope:'members',specialStops:row.special_stops||'',stops:row.notes||'',date:row.ride_date||'',distance:Number(row.distance)||0,duration:Number(row.duration)||0,geometry:row.geometry||[],points:row.points||[],legs:row.legs||[]}));
    try{localStorage.setItem(PLANNED_ROUTES_KEY,JSON.stringify([...remote,...local]));renderPlannedRoutes()}catch(e){}
  }
  window.savePlannedRoute=async function(){
    const scope=document.getElementById('routeScope').value;localSavePlannedRoute();if(scope!=='members'||!session)return;
    const route=getPlannedRoutes().find(item=>item.scope==='members'&&!item.onlineShared);if(!route)return;
    const {data,error}=await client.from('planned_routes').insert({user_id:session.user.id,name:route.name,ride_date:route.date||null,notes:route.stops||'',special_stops:route.specialStops||'',distance:route.distance,duration:route.duration,geometry:route.geometry,points:route.points,legs:route.legs||[]}).select('id').single();
    if(error){showToast('端末には保存しましたが、メンバー共有に失敗しました');return}route.id='online-'+data.id;route.onlineId=data.id;route.onlineShared=true;try{localStorage.setItem(PLANNED_ROUTES_KEY,JSON.stringify([route,...getPlannedRoutes().filter(item=>item!==route)]))}catch(e){}await syncSharedRoutes();showToast('予定ルートをメンバーと共有しました');
  };
  window.deleteSharedRoute=async function(id){
    const route=getPlannedRoutes().find(item=>String(item.id)===String(id));if(!route?.onlineShared)return localDeletePlannedRoute(id);if(route.ownerId!==session?.user.id){showToast('共有した本人だけが削除できます');return}if(!confirm('この共有ルートを削除しますか？'))return;const result=await client.from('planned_routes').delete().eq('id',route.onlineId);if(result.error){showToast('共有ルートを削除できませんでした');return}await syncSharedRoutes();showToast('共有ルートを削除しました');
  };window.deletePlannedRoute=window.deleteSharedRoute;
  window.openPhotoPost=function(){if(!session){openMemberAuth();showToast('写真の共有にはログインが必要です');return}localOpenPhotoPost()};
  window.savePhotoPost=async function(){
    if(!session)return localSavePhotoPost();
    const error=document.getElementById('photoPostError');error.classList.remove('show');
    if(!selectedPhotoFile){error.textContent='先に写真を選んでください。';error.classList.add('show');return}
    const withLocation=document.getElementById('photoShowLocation').checked;if(withLocation&&!selectedPhotoLocation){error.textContent='地図をタップして写真の場所を指定してください。';error.classList.add('show');return}
    const button=document.querySelector('#photoPostModal .close');button.disabled=true;button.textContent='共有しています…';
    try{
      const blob=await preparePhotoBlob(selectedPhotoFile),thumb=await preparePhotoThumbnail(selectedPhotoFile),id=crypto.randomUUID(),path=session.user.id+'/'+id+'.jpg',thumbPath=session.user.id+'/'+id+'-thumb.jpg';
      let result=await client.storage.from('ride-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false});if(result.error)throw result.error;
      result=await client.storage.from('ride-photos').upload(thumbPath,thumb,{contentType:'image/jpeg',upsert:false});if(result.error){await client.storage.from('ride-photos').remove([path]);throw result.error}
      result=await client.from('photo_posts').insert({id,user_id:session.user.id,storage_path:path,thumbnail_path:thumbPath,caption:document.getElementById('photoCaption').value.trim(),lat:withLocation?selectedPhotoLocation[0]:null,lng:withLocation?selectedPhotoLocation[1]:null});
      if(result.error){const cleanup=await client.storage.from('ride-photos').remove([path,thumbPath]);if(cleanup.error)queuePhotoCleanup([path,thumbPath]);throw result.error}
      closePhotoPost();await window.renderPhotoPosts();showToast('写真をメンバーと共有しました');
    }catch(e){error.textContent='写真を共有できませんでした。Supabaseの初期設定と通信状態を確認してください。';error.classList.add('show')}finally{button.disabled=false;button.textContent='メンバーと写真を共有'}
  };
  window.deletePhotoPost=async function(id){
    if(!session)return localDeletePhotoPost(id);if(!confirm('この共有写真を削除しますか？'))return;
    const {data,error}=await client.from('photo_posts').select('storage_path,thumbnail_path').eq('id',id).single();if(error){showToast('写真を削除できませんでした');return}
    const deleted=await client.from('photo_posts').delete().eq('id',id);if(deleted.error){showToast('投稿情報を削除できませんでした');return}await window.renderPhotoPosts();const paths=[data.storage_path,data.thumbnail_path].filter(Boolean),removed=await client.storage.from('ride-photos').remove(paths);if(removed.error)queuePhotoCleanup(paths);showToast(removed.error?'投稿は削除済みです。写真整理は次回再試行します':'写真を削除しました');
  };
  async function getOnlinePosts(){
    let query=client.from('photo_posts').select('id,user_id,storage_path,thumbnail_path,caption,lat,lng,created_at',{count:'exact'}).order('created_at',{ascending:false}).range(0,photoVisible-1);
    if(photoFilter==='mine')query=query.eq('user_id',session.user.id);else if(photoFilter==='member')query=query.eq('user_id',selectedMemberId||session.user.id);
    const {data,error,count}=await query;if(error)throw error;const rows=data||[];if(!rows.length)return {posts:[],count:0};
    const signed=await client.storage.from('ride-photos').createSignedUrls(rows.map(row=>row.thumbnail_path||row.storage_path),3600);if(signed.error)throw signed.error;
    const names=new Map(members.map(m=>[m.id,m.display_name]));return {count:count||rows.length,posts:rows.map((row,index)=>({id:row.id,userId:row.user_id,imageUrl:signed.data[index]?.signedUrl||'',caption:row.caption||'',lat:row.lat===null?null:Number(row.lat),lng:row.lng===null?null:Number(row.lng),createdAt:new Date(row.created_at).getTime(),ownerName:names.get(row.user_id)||'メンバー',online:true}))};
  }
  window.renderPhotoPosts=async function(){
    if(!session)return localRenderPhotoPosts();let posts=[],total=0;try{const result=await getOnlinePosts();posts=result.posts;total=result.count}catch(e){document.getElementById('localPhotoFeed').innerHTML='<article class="feed-card"><p class="feed-text">オンライン写真を読み込めません。Supabaseの初期設定を確認してください。</p></article>';return}
    const feed=document.getElementById('localPhotoFeed'),wrap=document.getElementById('photoMapWrap');photoObjectUrls.forEach(url=>URL.revokeObjectURL(url));photoObjectUrls=[];feed.replaceChildren();
    if(!posts.length){const empty=document.createElement('article');empty.className='feed-card';empty.innerHTML='<p class="feed-text">この表示には、まだ写真がありません。</p>';feed.append(empty)}
    posts.forEach(post=>{const card=document.createElement('article');card.className='feed-card';if(post.userId===session.user.id){const del=document.createElement('button');del.className='photo-delete';del.type='button';del.textContent='削除';del.onclick=()=>deletePhotoPost(post.id);card.append(del)}const head=document.createElement('div');head.className='feed-head';const face=document.createElement('div');face.className='face';face.style.margin='0';face.textContent=post.ownerName.slice(0,1);const info=document.createElement('div'),title=document.createElement('b'),time=document.createElement('small');title.textContent=post.ownerName+'さんの写真';time.textContent=new Date(post.createdAt).toLocaleString('ja-JP');info.append(title,time);head.append(face,info);const img=document.createElement('img');img.className='photo-post-image';img.src=post.imageUrl;img.alt=post.caption||post.ownerName+'さんのツーリング写真';card.append(head,img);if(post.caption){const text=document.createElement('p');text.className='feed-text';text.textContent=post.caption;card.append(text)}const badge=document.createElement('span');badge.className='photo-location-badge';badge.textContent=Number.isFinite(post.lat)&&Number.isFinite(post.lng)?'地図に表示':'位置情報なし';card.append(badge);feed.append(card)});
    if(posts.length<total){const more=document.createElement('button');more.className='close';more.type='button';more.textContent='さらに30件読み込む（'+posts.length+' / '+total+'）';more.onclick=loadMorePhotos;feed.append(more)}const located=posts.filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng));wrap.classList.toggle('show',located.length>0);if(!located.length){if(photoMapMarkers)photoMapMarkers.clearLayers();return}initPhotoMap();photoMapMarkers.clearLayers();clusterLocatedPhotos(located).forEach(group=>{const post=group.photos[0],safeUrl=post.imageUrl.replace(/&/g,'&amp;').replace(/"/g,'&quot;');const popup=document.createElement('div');popup.className='photo-popup';const image=document.createElement('img');image.src=post.imageUrl;image.alt='';const title=document.createElement('b');title.textContent=post.ownerName+'さん'+(post.caption?'：'+post.caption:'');const count=document.createElement('small');count.textContent=group.photos.length+'枚の写真';popup.append(image,title,count);const icon=L.divIcon({className:'photo-thumb-icon',html:'<div class="photo-thumb-pin"><img src="'+safeUrl+'" alt=""><span class="photo-thumb-count">'+group.photos.length+'</span></div>',iconSize:[78,90],iconAnchor:[39,88],popupAnchor:[0,-82]});L.marker([group.lat,group.lng],{icon}).bindPopup(popup).addTo(photoMapMarkers)});setTimeout(()=>{photoMap.invalidateSize();photoMap.fitBounds(located.map(p=>[p.lat,p.lng]),{padding:[55,55],maxZoom:12})},80);
  };
  document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMemberAuth()});
  if(!client){document.getElementById('shareStatusText').textContent='オンライン接続を読み込めませんでした';return}
  client.auth.getSession().then(({data})=>refreshSession(data.session));client.auth.onAuthStateChange((_event,nextSession)=>setTimeout(()=>refreshSession(nextSession),0));
})();
