$f = 'c:\xampp\htdocs\la-pacita-pickle-hub\lp\server.js'
$c = Get-Content $f -Raw

$c = $c -replace "app\.get\('/api/admin/courts',SUPER", "app.get('/api/admin/courts',STAFF"
$c = $c -replace "app\.post\('/api/admin/courts',SUPER", "app.post('/api/admin/courts',STAFF"
$c = $c -replace "app\.put\('/api/admin/courts/:id',SUPER", "app.put('/api/admin/courts/:id',STAFF"
$c = $c -replace "app\.delete\('/api/admin/courts/:id',SUPER", "app.delete('/api/admin/courts/:id',STAFF"

Set-Content $f -Value $c -NoNewline
Write-Host "server.js updated to allow staff to access courts endpoints"
