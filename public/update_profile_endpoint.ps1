$f = 'c:\xampp\htdocs\la-pacita-pickle-hub\lp\server.js'
$c = Get-Content $f -Raw

$putEndpoint = "app.put('/api/me',STAFF,async(q,s)=>{const{email,password}=q.body;try{if(email)await X('update users set email=? where id=?',email,q.u.id);if(password){if(password.length<8)return err(s,'Password must be 8+ characters.');await X('update users set pw=? where id=?',bcrypt.hashSync(password,10),q.u.id)}s.json({})}catch(e){err(s,'Email already taken.')}});"

$c = $c.Replace("app.get('/api/me',STAFF,(q,s)=>s.json(q.u));", "app.get('/api/me',STAFF,(q,s)=>s.json(q.u));`n" + $putEndpoint)

Set-Content $f -Value $c -NoNewline
Write-Host "server.js updated to include PUT /api/me endpoint"
