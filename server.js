require('dotenv').config();require('express-async-errors');
const express=require('express'),{Pool,types}=require('pg'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cookie=require('cookie-parser'),crypto=require('crypto');
types.setTypeParser(20,Number); // bigint -> number
const E=process.env,SECRET=E.JWT_SECRET||'dev-secret-change-me',MODE=E.PAYMENT_MODE||'manual',HOLD=600000;
const pool=new Pool({connectionString:E.DATABASE_URL,ssl:/localhost|127\.0\.0\.1/.test(E.DATABASE_URL||'')?false:{rejectUnauthorized:false}});
const P=s=>{let i=0;return s.replace(/\?/g,()=>'$'+ ++i)};
const Q=async(s,...a)=>(await pool.query(P(s),a)).rows,G=async(s,...a)=>(await Q(s,...a))[0],X=(s,...a)=>pool.query(P(s),a);
const gs=async()=>Object.fromEntries((await Q('select * from settings')).map(r=>[r.k,r.v])),ss=(k,v)=>X('insert into settings values(?,?) on conflict(k) do update set v=excluded.v',k,String(v));
async function init(){await pool.query(`create table if not exists users(id serial primary key,name text,email text unique,pw text,role text,active integer default 1);
create table if not exists courts(id serial primary key,name text,rate integer,active integer default 1);
create table if not exists settings(k text primary key,v text);
create table if not exists bookings(ref text primary key,name text,phone text,email text,court integer,date text,hour integer,players integer,amount integer,gref text,pm_id text,status text,paid integer default 0,created bigint);`);
 for(const t of['users','courts','settings','bookings'])await pool.query(`alter table ${t} enable row level security`); // blocks Supabase's public API; this server bypasses RLS
 if(!await G('select 1 from users')){await X("insert into users(name,email,pw,role) values('Owner',?,?,'super')",E.SUPER_EMAIL||'super@lapacita.ph',bcrypt.hashSync(E.SUPER_PASSWORD||'ChangeMe123',10));
  for(const c of[['Court 1',400],['Court 2',400],['Court 3',450]])await X('insert into courts(name,rate) values(?,?)',...c);
  for(const x of[['gname','La Pacita Pickle Hub'],['gnum',''],['qr',''],['dp',100],['qrcodes','[]']])await ss(...x)}}
const pht=()=>new Date(Date.now()+288e5),today=()=>pht().toISOString().slice(0,10);
const taken=async(c,d,h)=>!!await G("select 1 from bookings where court=? and date=? and hour=? and (status in ('Pending','Accepted') or (status='Unpaid' and created>?))",c,d,h,Date.now()-HOLD);
const fix=b=>b.status=='Unpaid'&&b.created<Date.now()-HOLD?{...b,status:'Expired'}:b;
const err=(s,m,c=400)=>s.status(c).json({error:m});
const auth=(...roles)=>async(q,s,n)=>{try{const t=jwt.verify(q.cookies.t,SECRET),u=await G('select id,name,email,role from users where id=? and active=1',t.id);if(!u||!roles.includes(u.role))throw 0;q.u=u}catch(e){return err(s,'Please sign in',401)}n()};
const STAFF=auth('admin','super'),SUPER=auth('super');
const app=express();app.set('trust proxy',1);app.use(cookie());

app.get('/healthz',(q,s)=>s.send('ok'));

// PayMongo webhook (raw body needed for signature check)
app.post('/api/paymongo/webhook',express.raw({type:'*/*'}),async(q,s)=>{
 let a;try{
  const sig=Object.fromEntries((q.get('paymongo-signature')||'').split(',').map(x=>x.split('='))),h=crypto.createHmac('sha256',E.PAYMONGO_WEBHOOK_SECRET||'x').update(sig.t+'.'+q.body).digest('hex');
  if(![sig.te,sig.li].includes(h))return s.sendStatus(400);a=JSON.parse(q.body).data.attributes}catch(e){return s.sendStatus(400)}
 if(a.type=='checkout_session.payment.paid'){const ref=a.data?.attributes?.metadata?.ref,b=await G('select * from bookings where ref=?',ref);
  if(b&&b.status=='Unpaid'){const clash=b.created<Date.now()-HOLD&&await taken(b.court,b.date,b.hour);await X('update bookings set status=?,paid=1 where ref=?',clash?'Refund':E.AUTO_ACCEPT=='true'?'Accepted':'Pending',ref)}}
 s.sendStatus(200)});

app.use(express.json({limit:'1mb'}));app.use(express.static('public'));

// Public
app.get('/api/config',async(q,s)=>{const p=await gs();let qrcodes=[];try{qrcodes=JSON.parse(p.qrcodes||'[]')}catch(e){}if(!qrcodes.length&&p.qr)qrcodes=[{label:'GCash',img:p.qr}];s.json({mode:MODE,courts:await Q('select id,name,rate from courts where active=1 order by id'),pay:{dp:+p.dp,gname:p.gname,gnum:p.gnum,qr:p.qr,qrcodes}})});
app.get('/api/slots',async(q,s)=>s.json({taken:(await Q("select hour from bookings where court=? and date=? and (status in ('Pending','Accepted') or (status='Unpaid' and created>?))",+q.query.court||0,String(q.query.date),Date.now()-HOLD)).map(r=>r.hour)}));
app.post('/api/book',async(q,s)=>{const{name,phone,email,court,date,hour,players,gref}=q.body,c=Number.isInteger(court)?await G('select * from courts where id=? and active=1',court):null;
 if(!c||!String(name||'').trim()||!String(phone||'').trim()||!/^\S+@\S+\.\S+$/.test(email||''))return err(s,'Please complete all details.');
 if(!/^\d{4}-\d\d-\d\d$/.test(date)||date<today()||!Number.isInteger(hour)||hour<6||hour>21||(date==today()&&hour<=pht().getUTCHours())||!(players>=1&&players<=8))return err(s,'Invalid date, time or number of players.');
 const g=String(gref||'').replace(/\s/g,'');if(MODE=='manual'&&!/^\d{8,15}$/.test(g))return err(s,'Enter the GCash reference number from your receipt.');
 if(await taken(court,date,hour))return err(s,'Sorry, that slot was just taken.',409);
 const ref='LP-'+crypto.randomBytes(3).toString('hex').toUpperCase(),amt=Math.round(c.rate*(await gs()).dp/100);
 try{await X('insert into bookings(ref,name,phone,email,court,date,hour,players,amount,gref,status,created) values(?,?,?,?,?,?,?,?,?,?,?,?)',ref,name.trim(),phone.trim(),email.trim(),court,date,hour,players|0,amt,g,MODE=='manual'?'Pending':'Unpaid',Date.now())}catch(e){return err(s,'Could not save booking, please try again.',500)}
 if(MODE=='manual')return s.json({ref,court:c.name,date,hour,amount:amt});
 try{const r=await fetch('https://api.paymongo.com/v1/checkout_sessions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(E.PAYMONGO_SECRET_KEY+':').toString('base64')},
  body:JSON.stringify({data:{attributes:{line_items:[{currency:'PHP',amount:amt*100,name:`${c.name} ${date} ${hour}:00`,quantity:1}],payment_method_types:['gcash'],description:'La Pacita Pickle Hub '+ref,success_url:E.BASE_URL+'/?paid='+ref,cancel_url:E.BASE_URL+'/?cancel='+ref,metadata:{ref}}}})}).then(r=>r.json());
  const url=r.data?.attributes?.checkout_url;if(!url)throw 0;await X('update bookings set pm_id=? where ref=?',r.data.id,ref);s.json({ref,url})}
 catch(e){await X("update bookings set status='Cancelled' where ref=?",ref);err(s,'Payment service unavailable. Please try again.',502)}});
app.get('/api/booking/:ref',async(q,s)=>{const b=await G('select b.ref,b.date,b.hour,b.status,b.created,c.name court from bookings b join courts c on c.id=b.court where b.ref=?',q.params.ref.toUpperCase());b?s.json(fix(b)):err(s,'No booking found for that code.',404)});

// Auth
app.post('/api/login',async(q,s)=>{const u=await G('select * from users where lower(email)=lower(?) and active=1',String(q.body.email||''));
 if(!u||!bcrypt.compareSync(String(q.body.password||''),u.pw))return err(s,'Wrong email or password.',401);
 s.cookie('t',jwt.sign({id:u.id},SECRET,{expiresIn:'12h'}),{httpOnly:true,sameSite:'lax',secure:E.NODE_ENV=='production',maxAge:432e5});s.json({name:u.name,role:u.role})});
app.post('/api/logout',(q,s)=>{s.clearCookie('t');s.json({})});
app.get('/api/me',STAFF,(q,s)=>s.json(q.u));

// Staff: Admin = view + accept only. Super = everything.
app.get('/api/admin/bookings',STAFF,async(q,s)=>s.json((await Q('select b.*,c.name cname from bookings b left join courts c on c.id=b.court order by b.date desc,b.hour desc limit 500')).map(fix)));
app.post('/api/admin/bookings/:ref/status',STAFF,async(q,s)=>{const st=q.body.status,b=await G('select * from bookings where ref=?',q.params.ref);
 if(!b)return err(s,'Not found',404);
 if(q.u.role=='admin'&&!(st=='Accepted'&&b.status=='Pending'))return err(s,'Admins can only accept pending bookings.',403);
 if(!['Accepted','Rejected','Cancelled'].includes(st))return err(s,'Invalid status');
 if(st=='Accepted'&&b.status!='Pending')return err(s,'Only paid/pending bookings can be accepted.');
 await X('update bookings set status=? where ref=?',st,b.ref);s.json({ok:1})});

// Super Admin only
app.get('/api/admin/courts',SUPER,async(q,s)=>s.json(await Q('select * from courts order by id')));
app.post('/api/admin/courts',SUPER,async(q,s)=>{await X('insert into courts(name,rate) values(?,400)','Court '+((await Q('select 1 from courts')).length+1));s.json({})});
app.put('/api/admin/courts/:id',SUPER,async(q,s)=>{const{name,rate,active}=q.body;await X('update courts set name=?,rate=?,active=? where id=?',String(name).slice(0,40),Math.max(0,+rate|0),active?1:0,+q.params.id);s.json({})});
app.get('/api/admin/users',SUPER,async(q,s)=>s.json(await Q("select id,name,email,active from users where role='admin' order by id")));
app.post('/api/admin/users',SUPER,async(q,s)=>{const{name,email,password}=q.body;
 if(!name||!/^\S+@\S+\.\S+$/.test(email||'')||String(password||'').length<8)return err(s,'Enter a name, valid email and a password of 8+ characters.');
 try{await X("insert into users(name,email,pw,role) values(?,?,?,'admin')",name,email,bcrypt.hashSync(password,10));s.json({})}catch(e){err(s,'That email already exists.')}});
app.put('/api/admin/users/:id',SUPER,async(q,s)=>{const{active,password}=q.body,id=+q.params.id;
 if(password){if(password.length<8)return err(s,'Password must be 8+ characters.');await X("update users set pw=? where id=? and role='admin'",bcrypt.hashSync(password,10),id)}
 if(active!==undefined)await X("update users set active=? where id=? and role='admin'",active?1:0,id);s.json({})});
app.delete('/api/admin/users/:id',SUPER,async(q,s)=>{await X("delete from users where id=? and role='admin'",+q.params.id);s.json({})});
app.get('/api/admin/settings',SUPER,async(q,s)=>s.json(await gs()));
app.put('/api/admin/settings',SUPER,async(q,s)=>{for(const k of['gname','gnum','dp','qr','qrcodes']){const v=q.body[k];if(v===undefined)continue;if(k=='dp'&&![30,50,100].includes(+v))continue;if(k=='qr'&&v&&!/^data:image\/(jpeg|png);base64,/.test(v))continue;if(k=='qrcodes'){try{const arr=typeof v==='string'?JSON.parse(v):v;if(!Array.isArray(arr))continue;await ss(k,JSON.stringify(arr))}catch(e){continue}}else{await ss(k,v)}}s.json({})});

app.use((e,q,s,n)=>{console.error(e);err(s,'Server error',500)});
init().then(()=>app.listen(E.PORT||3000,()=>console.log('La Pacita Pickle Hub running · payment mode: '+MODE))).catch(e=>{console.error('Database error:',e.message);process.exit(1)});
