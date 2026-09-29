require('dotenv').config();
const express=require('express'),Database=require('better-sqlite3'),bcrypt=require('bcryptjs'),jwt=require('jsonwebtoken'),cookie=require('cookie-parser'),crypto=require('crypto');
const E=process.env,SECRET=E.JWT_SECRET||'dev-secret-change-me',MODE=E.PAYMENT_MODE||'manual',HOLD=600000;
const db=new Database(E.DB_PATH||'data.db');db.pragma('journal_mode=WAL');
db.exec(`create table if not exists users(id integer primary key,name,email unique,pw,role,active integer default 1);
create table if not exists courts(id integer primary key,name,rate integer,active integer default 1);
create table if not exists settings(k primary key,v);
create table if not exists bookings(ref primary key,name,phone,email,court integer,date,hour integer,players integer,amount integer,gref,pm_id,status,paid integer default 0,created integer);`);
const Q=(s,...a)=>db.prepare(s).all(...a),G=(s,...a)=>db.prepare(s).get(...a),X=(s,...a)=>db.prepare(s).run(...a);
const gs=()=>Object.fromEntries(Q('select * from settings').map(r=>[r.k,r.v])),ss=(k,v)=>X('insert into settings values(?,?) on conflict(k) do update set v=excluded.v',k,String(v));
if(!G('select 1 from users')){X("insert into users(name,email,pw,role) values('Owner',?,?,'super')",E.SUPER_EMAIL||'super@lapacita.ph',bcrypt.hashSync(E.SUPER_PASSWORD||'ChangeMe123',10));
 [['Court 1',400],['Court 2',400],['Court 3',450]].forEach(c=>X('insert into courts(name,rate) values(?,?)',...c));[['gname','La Pacita Pickle Hub'],['gnum',''],['qr',''],['dp',100]].forEach(x=>ss(...x))}
const pht=()=>new Date(Date.now()+288e5),today=()=>pht().toISOString().slice(0,10);
const taken=(c,d,h)=>!!G("select 1 from bookings where court=? and date=? and hour=? and (status in ('Pending','Accepted') or (status='Unpaid' and created>?))",c,d,h,Date.now()-HOLD);
const fix=b=>b.status=='Unpaid'&&b.created<Date.now()-HOLD?{...b,status:'Expired'}:b;
const err=(s,m,c=400)=>s.status(c).json({error:m});
const auth=(...roles)=>(q,s,n)=>{try{const t=jwt.verify(q.cookies.t,SECRET),u=G('select id,name,email,role from users where id=? and active=1',t.id);if(!u||!roles.includes(u.role))throw 0;q.u=u;n()}catch(e){err(s,'Please sign in',401)}};
const STAFF=auth('admin','super'),SUPER=auth('super');
const app=express();app.set('trust proxy',1);app.use(cookie());

// PayMongo webhook (raw body needed for signature check)
app.post('/api/paymongo/webhook',express.raw({type:'*/*'}),(q,s)=>{try{
 const sig=Object.fromEntries((q.get('paymongo-signature')||'').split(',').map(x=>x.split('='))),h=crypto.createHmac('sha256',E.PAYMONGO_WEBHOOK_SECRET||'x').update(sig.t+'.'+q.body).digest('hex');
 if(![sig.te,sig.li].includes(h))return s.sendStatus(400);
 const a=JSON.parse(q.body).data.attributes;
 if(a.type=='checkout_session.payment.paid'){const ref=a.data.attributes.metadata?.ref,b=G('select * from bookings where ref=?',ref);
  if(b&&b.status=='Unpaid'){const clash=b.created<Date.now()-HOLD&&taken(b.court,b.date,b.hour);X('update bookings set status=?,paid=1 where ref=?',clash?'Refund':E.AUTO_ACCEPT=='true'?'Accepted':'Pending',ref)}}
 s.sendStatus(200)}catch(e){s.sendStatus(400)}});

app.use(express.json({limit:'1mb'}));app.use(express.static('public'));

// Public
app.get('/api/config',(q,s)=>{const p=gs();s.json({mode:MODE,courts:Q('select id,name,rate from courts where active=1'),pay:{dp:+p.dp,gname:p.gname,gnum:p.gnum,qr:p.qr}})});
app.get('/api/slots',(q,s)=>s.json({taken:Q("select hour from bookings where court=? and date=? and (status in ('Pending','Accepted') or (status='Unpaid' and created>?))",q.query.court,q.query.date,Date.now()-HOLD).map(r=>r.hour)}));
app.post('/api/book',async(q,s)=>{const{name,phone,email,court,date,hour,players,gref}=q.body,c=G('select * from courts where id=? and active=1',court);
 if(!c||!String(name||'').trim()||!String(phone||'').trim()||!/^\S+@\S+\.\S+$/.test(email||''))return err(s,'Please complete all details.');
 if(!/^\d{4}-\d\d-\d\d$/.test(date)||date<today()||!Number.isInteger(hour)||hour<6||hour>21||(date==today()&&hour<=pht().getUTCHours())||!(players>=1&&players<=8))return err(s,'Invalid date, time or number of players.');
 const g=String(gref||'').replace(/\s/g,'');if(MODE=='manual'&&!/^\d{8,15}$/.test(g))return err(s,'Enter the GCash reference number from your receipt.');
 if(taken(court,date,hour))return err(s,'Sorry, that slot was just taken.',409);
 const ref='LP-'+crypto.randomBytes(3).toString('hex').toUpperCase(),amt=Math.round(c.rate*gs().dp/100);
 X('insert into bookings(ref,name,phone,email,court,date,hour,players,amount,gref,status,created) values(?,?,?,?,?,?,?,?,?,?,?,?)',ref,name.trim(),phone.trim(),email.trim(),court,date,hour,players|0,amt,g,MODE=='manual'?'Pending':'Unpaid',Date.now());
 if(MODE=='manual')return s.json({ref,court:c.name,date,hour,amount:amt});
 try{const r=await fetch('https://api.paymongo.com/v1/checkout_sessions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Basic '+Buffer.from(E.PAYMONGO_SECRET_KEY+':').toString('base64')},
  body:JSON.stringify({data:{attributes:{line_items:[{currency:'PHP',amount:amt*100,name:`${c.name} ${date} ${hour}:00`,quantity:1}],payment_method_types:['gcash'],description:'La Pacita Pickle Hub '+ref,success_url:E.BASE_URL+'/?paid='+ref,cancel_url:E.BASE_URL+'/?cancel='+ref,metadata:{ref}}}})}).then(r=>r.json());
  const url=r.data?.attributes?.checkout_url;if(!url)throw 0;X('update bookings set pm_id=? where ref=?',r.data.id,ref);s.json({ref,url})}
 catch(e){X("update bookings set status='Cancelled' where ref=?",ref);err(s,'Payment service unavailable. Please try again.',502)}});
app.get('/api/booking/:ref',(q,s)=>{const b=G('select b.ref,b.date,b.hour,b.status,b.created,c.name court from bookings b join courts c on c.id=b.court where ref=?',q.params.ref.toUpperCase());b?s.json(fix(b)):err(s,'No booking found for that code.',404)});

// Auth
app.post('/api/login',(q,s)=>{const u=G('select * from users where lower(email)=lower(?) and active=1',q.body.email||'');
 if(!u||!bcrypt.compareSync(q.body.password||'',u.pw))return err(s,'Wrong email or password.',401);
 s.cookie('t',jwt.sign({id:u.id},SECRET,{expiresIn:'12h'}),{httpOnly:true,sameSite:'lax',secure:E.NODE_ENV=='production',maxAge:432e5});s.json({name:u.name,role:u.role})});
app.post('/api/logout',(q,s)=>{s.clearCookie('t');s.json({})});
app.get('/api/me',STAFF,(q,s)=>s.json(q.u));

// Staff: Admin = view + accept only. Super = everything.
app.get('/api/admin/bookings',STAFF,(q,s)=>s.json(Q('select b.*,c.name cname from bookings b left join courts c on c.id=b.court order by date desc,hour desc limit 500').map(fix)));
app.post('/api/admin/bookings/:ref/status',STAFF,(q,s)=>{const st=q.body.status,b=G('select * from bookings where ref=?',q.params.ref);
 if(!b)return err(s,'Not found',404);
 if(q.u.role=='admin'&&!(st=='Accepted'&&b.status=='Pending'))return err(s,'Admins can only accept pending bookings.',403);
 if(!['Accepted','Rejected','Cancelled'].includes(st))return err(s,'Invalid status');
 if(st=='Accepted'&&b.status!='Pending')return err(s,'Only paid/pending bookings can be accepted.');
 X('update bookings set status=? where ref=?',st,b.ref);s.json({ok:1})});

// Super Admin only
app.get('/api/admin/courts',SUPER,(q,s)=>s.json(Q('select * from courts')));
app.post('/api/admin/courts',SUPER,(q,s)=>{X('insert into courts(name,rate) values(?,400)','Court '+(Q('select 1 from courts').length+1));s.json({})});
app.put('/api/admin/courts/:id',SUPER,(q,s)=>{const{name,rate,active}=q.body;X('update courts set name=?,rate=?,active=? where id=?',String(name).slice(0,40),Math.max(0,+rate|0),active?1:0,q.params.id);s.json({})});
app.get('/api/admin/users',SUPER,(q,s)=>s.json(Q("select id,name,email,active from users where role='admin'")));
app.post('/api/admin/users',SUPER,(q,s)=>{const{name,email,password}=q.body;
 if(!name||!/^\S+@\S+\.\S+$/.test(email||'')||String(password||'').length<8)return err(s,'Enter a name, valid email and a password of 8+ characters.');
 try{X("insert into users(name,email,pw,role) values(?,?,?,'admin')",name,email,bcrypt.hashSync(password,10));s.json({})}catch(e){err(s,'That email already exists.')}});
app.put('/api/admin/users/:id',SUPER,(q,s)=>{const{active,password}=q.body;
 if(password){if(password.length<8)return err(s,'Password must be 8+ characters.');X("update users set pw=? where id=? and role='admin'",bcrypt.hashSync(password,10),q.params.id)}
 if(active!==undefined)X("update users set active=? where id=? and role='admin'",active?1:0,q.params.id);s.json({})});
app.delete('/api/admin/users/:id',SUPER,(q,s)=>{X("delete from users where id=? and role='admin'",q.params.id);s.json({})});
app.get('/api/admin/settings',SUPER,(q,s)=>s.json(gs()));
app.put('/api/admin/settings',SUPER,(q,s)=>{for(const k of['gname','gnum','dp','qr']){const v=q.body[k];if(v===undefined)continue;if(k=='dp'&&![30,50,100].includes(+v))continue;if(k=='qr'&&v&&!/^data:image\/(jpeg|png);base64,/.test(v))continue;ss(k,v)}s.json({})});

app.listen(E.PORT||3000,()=>console.log('La Pacita Pickle Hub running · payment mode: '+MODE));
