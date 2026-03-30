import {state,loadStatus,checkAuth,allowRoute,cleanup,stopOAuth,defaultRoute,parseHash,routes,authShell,shell,head,esc} from './common.js'
import {renderLogin} from './login.js'
import {renderDashboard} from './dashboard.js'
import {renderAccounts} from './accounts.js'
import {renderKeys} from './keys.js'
import {renderKeyDetail} from './key-detail.js'
import {renderLogs} from './logs.js'
import {renderUsers} from './users.js'
async function renderRoute(){const cur=parseHash();const name=cur.route||(state.user?defaultRoute():'login');if(state.activeRoute==='accounts'&&name!=='accounts'){stopOAuth();state.accounts.oauth=null}cleanup();if(!allowRoute(name))return;state.activeRoute=name;try{if(name==='login')return await renderLogin();if(name==='dashboard')return await renderDashboard();if(name==='accounts')return await renderAccounts();if(name==='keys')return await renderKeys();if(name==='key-detail')return await renderKeyDetail();if(name==='logs')return await renderLogs();if(name==='users')return await renderUsers()}catch(error){const msg=error?.message||'页面加载失败';if(name==='login'){authShell(`<section class="login-card"><div class="alert error">${esc(msg)}</div></section>`)}else{shell(name,`${head(routes[name].title,'页面加载失败')}<section class="card"><div class="alert error">${esc(msg)}</div><div class="form-actions"><button id="page-retry" class="btn primary">重试</button></div></section>`);document.getElementById('page-retry').onclick=()=>renderRoute()}}}
async function bootstrap(){await loadStatus();await checkAuth();if(!location.hash){location.hash=`#/${state.user?defaultRoute():'login'}`;return}await renderRoute()}
window.addEventListener('hashchange',()=>{renderRoute()})
bootstrap()
