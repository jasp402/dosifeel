const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL);
const SECRET = process.env.AUTH_SECRET;
const err=(s,m)=>Object.assign(new Error(m),{status:s});
const safe=(x)=>String(x||'').trim();
const key=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
const hash=(pw)=>{let salt=crypto.randomBytes(16).toString('hex');return salt+':'+key(pw,salt)};
const verify=(pw,stored)=>{let [salt,expected]=stored.split(':');return crypto.timingSafeEqual(Buffer.from(key(pw,salt),'hex'),Buffer.from(expected,'hex'))};
const token=(id)=>{const raw=Buffer.from(JSON.stringify({id,exp:Date.now()+30*86400000})).toString('base64url');return raw+'.'+crypto.createHmac('sha256',SECRET).update(raw).digest('base64url')};
const auth=(req)=>{const t=(req.headers.cookie||'').split('; ').find(x=>x.startsWith('df_session='))?.slice(11);if(!t)return null;let [raw,mac]=t.split('.');if(!raw||!mac)return null;let check=crypto.createHmac('sha256',SECRET).update(raw).digest('base64url');if(mac.length!==check.length||!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(check)))return null;let v=JSON.parse(Buffer.from(raw,'base64url').toString());return v.exp>Date.now()?v.id:null};
const session=(res,id,clear=false)=>res.setHeader('Set-Cookie','df_session='+(!clear?token(id):'')+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age='+(clear?'0':'2592000'));
let initialized=false;
async function init(){if(initialized)return;
 await sql`CREATE TABLE IF NOT EXISTS df_users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text UNIQUE NOT NULL, name text NOT NULL, passhash text NOT NULL, role text NOT NULL DEFAULT 'client', active boolean NOT NULL DEFAULT false, share_progress boolean, timezone text DEFAULT 'America/Lima', created_at timestamptz DEFAULT now())`;
 await sql`CREATE TABLE IF NOT EXISTS df_products (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, brand text NOT NULL DEFAULT 'FuXion', description text NOT NULL DEFAULT '', units text NOT NULL DEFAULT 'stick', servings numeric NOT NULL DEFAULT 1, instructions text NOT NULL DEFAULT '', image_url text DEFAULT '', active boolean DEFAULT true, created_at timestamptz DEFAULT now())`;
 await sql`CREATE TABLE IF NOT EXISTS df_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES df_users(id), product_id uuid REFERENCES df_products(id), inventory numeric NOT NULL DEFAULT 0, tolerance integer DEFAULT 60, time_of_day text NOT NULL DEFAULT '08:00', times jsonb DEFAULT '["08:00"]'::jsonb, daily_days jsonb DEFAULT '[0,1,2,3,4,5,6]'::jsonb, enabled boolean DEFAULT true, created_at timestamptz DEFAULT now(), UNIQUE(user_id,product_id))`;
 await sql`CREATE TABLE IF NOT EXISTS df_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid REFERENCES df_assignments(id), user_id uuid REFERENCES df_users(id), day text NOT NULL, scheduled text NOT NULL, quantity numeric NOT NULL DEFAULT 1, status text NOT NULL, appealed boolean DEFAULT false, created_at timestamptz DEFAULT now(), UNIQUE(assignment_id,day,scheduled))`;
 await sql`CREATE TABLE IF NOT EXISTS df_stock (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), assignment_id uuid REFERENCES df_assignments(id), delta numeric NOT NULL, reason text NOT NULL, created_at timestamptz DEFAULT now())`;
 await sql`CREATE TABLE IF NOT EXISTS df_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action text, metadata jsonb, created_at timestamptz DEFAULT now())`;
 initialized=true}
async function run(req,res){
 const op=safe(req.query.op), body=req.body||{}, method=req.method;const reply=(d,status=200)=>res.status(status).json(d);
 if(!SECRET)throw err(503,'AUTH_SECRET no configurado');
 await init();
 if(op==='register'&&method==='POST'){let email=safe(body.email).toLowerCase(),name=safe(body.name),password=safe(body.password);if(!/^\S+@\S+\.\S+$/.test(email)||name.length<2||password.length<8)throw err(400,'Nombre, correo y contraseña de 8+ caracteres requeridos');
 let seller=Boolean(process.env.SELLER_SETUP_CODE)&&safe(body.sellerCode)===process.env.SELLER_SETUP_CODE;
 if(seller){let existing=await sql`SELECT id FROM df_users WHERE role='seller' LIMIT 1`;if(existing.length)throw err(403,'La vendedora ya está configurada')}
 let rows=await sql`INSERT INTO df_users(email,name,passhash,role,active) VALUES(${email},${name},${hash(password)},${seller?'seller':'client'},${seller}) RETURNING id`.catch(e=>{if(e.code==='23505')throw err(409,'Este correo ya está registrado');throw e});session(res,rows[0].id);return reply({ok:true})}
 if(op==='login'&&method==='POST'){let rows=await sql`SELECT id,passhash FROM df_users WHERE email=${safe(body.email).toLowerCase()}`;if(!rows.length||!verify(safe(body.password),rows[0].passhash))throw err(401,'Credenciales incorrectas');session(res,rows[0].id);return reply({ok:true})}
 if(op==='logout'&&method==='POST'){session(res,'',true);return reply({ok:true})}
 let id=auth(req);if(!id)throw err(401,'Inicia sesión para continuar');
 let people=await sql`SELECT id,email,name,role,active,share_progress,timezone FROM df_users WHERE id=${id}`;if(!people.length)throw err(401,'Sesión inválida');let me=people[0],seller=me.role==='seller';
 if(op==='me'){return reply({user:me})}
 if(op==='catalog'){let products=await sql`SELECT * FROM df_products WHERE active=true ORDER BY name`;return reply({products})}
 if(op==='dashboard'){
 let products=await sql`SELECT p.id product_id,p.name,p.brand,p.units,p.servings,p.instructions,p.image_url,a.* FROM df_assignments a JOIN df_products p ON p.id=a.product_id WHERE a.user_id=${id} ORDER BY p.name`;
 let events=await sql`SELECT e.* FROM df_events e WHERE e.user_id=${id} AND e.day>=${safe(req.query.from)||new Date(Date.now()-40*86400000).toISOString().slice(0,10)} ORDER BY day DESC,scheduled`;
 return reply({assignments:products,events,user:me})}
 if(op==='privacy'&&method==='POST'){if(typeof body.share!=='boolean')throw err(400,'Selección inválida');await sql`UPDATE df_users SET share_progress=${body.share} WHERE id=${id}`;return reply({ok:true})}
 if(op==='schedule'&&method==='POST'){let assignment=safe(body.assignment),times=body.times;if(!Array.isArray(times)||times.length<1||times.length>6||times.some(x=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(x)))throw err(400,'Horario inválido');let tolerance=Number(body.tolerance);if(tolerance<0||tolerance>180)throw err(400,'Tolerancia entre 0 y 180 minutos');let days=body.days;if(!Array.isArray(days)||days.some(x=>!Number.isInteger(x)||x<0||x>6))throw err(400,'Días inválidos');
 await sql`UPDATE df_assignments SET times=${JSON.stringify(times)}::jsonb,time_of_day=${times[0]},tolerance=${tolerance},daily_days=${JSON.stringify(days)}::jsonb WHERE id=${assignment} AND user_id=${id}`;return reply({ok:true})}
 if(op==='take'&&method==='POST'){
 let aid=safe(body.assignment),day=safe(body.day),time=safe(body.time),status=safe(body.status),appeal=Boolean(body.appeal);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!/^\d\d:\d\d$/.test(time)||!['taken','missed','undo'].includes(status))throw err(400,'Registro inválido');
 let aa=await sql`SELECT * FROM df_assignments WHERE id=${aid} AND user_id=${id}`;if(!aa.length)throw err(404,'Producto no asignado');
 let a=aa[0];if(!(a.times||[]).includes(time))throw err(400,'Horario no vigente');if(day>new Date().toISOString().slice(0,10))throw err(400,'No puedes confirmar tomas futuras');
 let old=await sql`SELECT * FROM df_events WHERE assignment_id=${aid} AND day=${day} AND scheduled=${time}`;
 let prev=old.length?old[0].status:null;let next=status==='undo'?'missed':status;
 if(next==='taken'&&prev!=='taken'){if(Number(a.inventory)<Number(a.servings))throw err(409,'Inventario insuficiente; consulta con tu asesora');await sql`UPDATE df_assignments SET inventory=inventory-${Number(a.servings)} WHERE id=${aid}`;await sql`INSERT INTO df_stock(assignment_id,delta,reason) VALUES(${aid},${-Number(a.servings)},'consumo')`}
 if(next!=='taken'&&prev==='taken'){await sql`UPDATE df_assignments SET inventory=inventory+${Number(a.servings)} WHERE id=${aid}`;await sql`INSERT INTO df_stock(assignment_id,delta,reason) VALUES(${aid},${Number(a.servings)},'correccion')`}
 await sql`INSERT INTO df_events(assignment_id,user_id,day,scheduled,quantity,status,appealed) VALUES(${aid},${id},${day},${time},${Number(a.servings)},${next},${appeal}) ON CONFLICT (assignment_id,day,scheduled) DO UPDATE SET status=${next},appealed=${appeal},created_at=now()`;
 await sql`INSERT INTO df_audit(user_id,action,metadata) VALUES(${id},'take',${JSON.stringify({aid,day,time,prev,next,appeal})}::jsonb)`;return reply({ok:true})}
 if(!seller)throw err(403,'Acceso exclusivo de la vendedora');
 if(op==='clients'){let rows=await sql`SELECT id,email,name,active,share_progress,created_at FROM df_users WHERE role='client' ORDER BY created_at DESC`;let stock=await sql`SELECT a.user_id,a.id,a.inventory,p.servings,p.name,p.units,a.times,a.daily_days FROM df_assignments a JOIN df_products p ON p.id=a.product_id`;return reply({clients:rows,stock})}
 if(op==='activate'&&method==='POST'){let email=safe(body.email).toLowerCase();let r=await sql`UPDATE df_users SET active=${Boolean(body.active)} WHERE email=${email} AND role='client' RETURNING id`;if(!r.length)throw err(404,'Cliente no encontrado');return reply({ok:true})}
 if(op==='product'&&method==='POST'){let name=safe(body.name),brand=safe(body.brand)||'FuXion',description=safe(body.description),instructions=safe(body.instructions),units=safe(body.units)||'stick';if(name.length<2||!instructions)throw err(400,'Nombre e instrucciones obligatorios');let a=await sql`INSERT INTO df_products(name,brand,description,instructions,units,servings) VALUES(${name},${brand},${description},${instructions},${units},${Number(body.servings)||1}) RETURNING *`;return reply({product:a[0]})}
 if(op==='assign'&&method==='POST'){
 let user=safe(body.user),product=safe(body.product),quantity=Number(body.quantity);if(!Number.isFinite(quantity)||quantity<=0)throw err(400,'Cantidad positiva requerida');
 let c=await sql`SELECT id FROM df_users WHERE id=${user} AND active=true AND role='client'`;if(!c.length)throw err(400,'Activa al cliente antes de asignar');let p=await sql`SELECT id FROM df_products WHERE id=${product}`;if(!p.length)throw err(404,'Producto no encontrado');
 let a=await sql`INSERT INTO df_assignments(user_id,product_id,inventory) VALUES(${user},${product},${quantity}) ON CONFLICT(user_id,product_id) DO UPDATE SET inventory=df_assignments.inventory+${quantity},enabled=true RETURNING id`;
 await sql`INSERT INTO df_stock(assignment_id,delta,reason) VALUES(${a[0].id},${quantity},'venta o reposicion')`;return reply({ok:true})}
 throw err(404,'Operación no encontrada');
}
module.exports=async(req,res)=>{try{await run(req,res)}catch(e){console.error('DosiFeel API',e.message);res.status(e.status||500).json({error:e.status?e.message:'Error del servidor. Revisa la configuración de Neon.'})}};
