'use strict';
// Verificación sin dependencias: node --test tests/validar.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script, {filename:'index.html'});

function app(saved = new Map(), options = {}) {
  const context = vm.createContext({crypto:webcrypto,console,localStorage:{
    getItem:key=>saved.has(key)?saved.get(key):null,
    setItem:(key,value)=>{if(options.failWrite||options.failKey===key)throw new Error('QuotaExceededError');saved.set(key,value);},
    removeItem:key=>saved.delete(key)
  }});
  const run = code=>vm.runInContext(code,context);
  run(script);
  return {run,saved};
}
const fixture = `
  const bank = data.accounts.find(a=>a.name==='Banco');
  const cash = data.accounts.find(a=>a.name==='Efectivo');
  const salary = data.categories.find(c=>c.name==='Salario');
  const food = data.categories.find(c=>c.name==='Despensa');
  function movement(type,amount,categoryId,accountId=bank.id,date='2026-10-10') {
    return {id:uid(),type,amount,categoryId,accountId,date,description:'Prueba'};
  }
`;

test('Estado inicial: dos cuentas, veinte categorías y totales en cero',()=>{
  const {run}=app();
  assert.equal(run('validateData(data)'),true);
  assert.equal(run('data.accounts.length'),2);
  assert.equal(run('data.categories.filter(c=>c.type==="expense").length'),17);
  assert.equal(run('data.categories.filter(c=>c.type==="income").length'),3);
  assert.equal(run('monthSummary(data,"2026-10").total'),0);
  assert.equal(run('data.categories.filter(c=>c.type==="expense").every(c=>c.classification===null)'),true);
  assert.equal(run('data.categories.filter(c=>c.type==="income").some(c=>"classification" in c)'),false);
});

test('A: saldo inicial $10,000 + ingreso $5,000 − gasto $2,000 = $13,000',()=>{
  const {run}=app();run(fixture);
  run('bank.opening=1000000; data.movements=[movement("income",500000,salary.id),movement("expense",200000,food.id)]');
  assert.equal(run('validateData(data)'),true);
  assert.equal(run('accountBalances().find(a=>a.id===bank.id).balance'),1300000);
  assert.equal(run('monthSummary(data,"2026-10").total'),1300000);
  assert.equal(run('monthSummary(data,"2026-10").balance'),300000);
});

test('B: tres categorías distribuyen el gasto en 10 %, 30 % y 60 %; edición y eliminación recalculan',()=>{
  const {run}=app();run(fixture);
  run('data.movements=[movement("expense",10000,data.categories[0].id),movement("expense",30000,data.categories[1].id),movement("expense",60000,data.categories[2].id)]');
  assert.equal(run('JSON.stringify(categoryBreakdown(data.movements).map(c=>c.percentage))'),'[60,30,10]');
  assert.equal(run('categoryBreakdown(data.movements).reduce((sum,c)=>sum+c.amount,0)'),100000);
  run('data.movements[0].amount=20000; data.movements=data.movements.slice(0,2)');
  assert.equal(run('categoryBreakdown(data.movements).reduce((sum,c)=>sum+c.amount,0)'),50000);
  assert.equal(run('JSON.stringify(categoryBreakdown(data.movements).map(c=>c.percentage))'),'[60,40]');
});

test('C y F: categoría personalizada, movimiento y clasificación persisten al recargar',()=>{
  const first=app();first.run(fixture);
  first.run('const custom={id:uid(),name:"Mascotas",type:"expense",custom:true,classification:"amarillo"}; data.categories.push(custom); data.movements.push(movement("expense",12550,custom.id,bank.id,"2026-10-20"))');
  assert.equal(first.run('commit(data).ok'),true);
  const second=app(first.saved);
  assert.equal(second.run('data.categories.find(c=>c.name==="Mascotas").custom'),true);
  assert.equal(second.run('data.categories.find(c=>c.name==="Mascotas").classification'),'amarillo');
  assert.equal(second.run('"classification" in data.movements[0]'),false);
  assert.equal(second.run('monthSummary(data,"2026-10").expense'),12550);
  assert.equal(second.run('validateData(data)'),true);
});

test('D: cuenta personalizada y decimales mantienen saldos individuales y generales exactos',()=>{
  const {run}=app();run(fixture);
  run('bank.opening=1000000; const personal={id:uid(),name:"Personal",opening:125010}; data.accounts.push(personal); data.movements=[movement("income",12515,salary.id,personal.id),movement("expense",2505,food.id,personal.id)]');
  assert.equal(run('accountBalances().find(a=>a.id===personal.id).balance'),135020);
  assert.equal(run('monthSummary(data,"2026-10").total'),1135020);
  assert.equal(run('accountBalances().find(a=>a.id===bank.id).balance'),1000000);
});

test('E: cambio de mes separa ingresos, gastos, listas y balance sin cambiar el saldo total',()=>{
  const {run}=app();run(fixture);
  run('data.movements=[movement("income",10000,salary.id,bank.id,"2026-10-01"),movement("expense",4000,food.id,bank.id,"2026-10-31"),movement("expense",8000,food.id,bank.id,"2026-09-30")]');
  assert.equal(run('monthSummary(data,"2026-10").income'),10000);
  assert.equal(run('monthSummary(data,"2026-10").expense'),4000);
  assert.equal(run('monthSummary(data,"2026-10").balance'),6000);
  assert.equal(run('monthSummary(data,"2026-09").balance'),-8000);
  assert.equal(run('monthSummary(data,"2026-09").movements.length'),1);
  assert.equal(run('monthSummary(data,"2026-10").movements.length'),2);
  assert.equal(run('monthSummary(data,"2026-11").movements.length'),0);
  assert.equal(run('monthSummary(data,"2026-11").total'),-2000);
});

test('G: reinicio exige confirmación; solo al ejecutarla restaura un estado válido y persistente',()=>{
  const {run,saved}=app();run('data=demoData("2026-10"); commit(data)');
  run(`
    const elements={};
    const node=id=>elements[id]||(elements[id]={textContent:'',hidden:false,className:'',showModal(){this.open=true;}});
    globalThis.document={getElementById:node};
    globalThis.clearTimeout=()=>{};
    globalThis.setTimeout=()=>0;
    resetAll();
  `);
  assert.equal(run('data.movements.length'),20);
  assert.equal(run('elements["confirmation-dialog"].open'),true);
  assert.equal(run('elements["confirm-action"].textContent'),'Sí, reiniciar todo');
  assert.equal(run('typeof pendingConfirmation'),'function');
  assert.equal(run('pendingConfirmation().ok'),true);
  assert.equal(run('data.movements.length'),0);
  assert.equal(run('data.accounts.length'),2);
  assert.equal(run('data.categories.length'),20);
  assert.equal(run('validateData(data)'),true);
  assert.equal(app(saved).run('monthSummary().total'),0);
});

test('Importes: centavos exactos y rechazo de vacíos, separadores ambiguos, desbordamientos y números no finitos',()=>{
  const {run}=app();
  for (const [value,expected] of [['0.10',10],['0,20',20],['1250.50',125050],['1',100],['999999999.99',99999999999]]) assert.equal(run(`parseMoney(${JSON.stringify(value)})`),expected);
  for (const value of ['',' ','-2','NaN','Infinity','1e3','1,000.00','1.000,00','12.345','1000000000','<script>']) assert.equal(run(`parseMoney(${JSON.stringify(value)})`),null);
  assert.equal(run('parseMoney("",{emptyIsZero:true})'),0);
  assert.equal(run('parseMoney("-1.50",{allowNegative:true})'),-150);
  assert.equal(run('parseMoney("0.10")+parseMoney("0.20")'),30);
});

test('Fechas: año bisiesto, fechas inválidas y navegación diciembre/enero',()=>{
  const {run}=app();
  assert.equal(run('validDate("2024-02-29")'),true);
  for(const date of ['2026-02-29','2026-04-31','2026-13-01','','2026-2-01','0000-01-01']) assert.equal(run(`validDate(${JSON.stringify(date)})`),false);
  assert.equal(run('shiftMonth("2026-12",1)'),'2027-01');
  assert.equal(run('shiftMonth("2026-01",-1)'),'2025-12');
  assert.equal(run('shiftMonth("1000-01",-1)'),'1000-01');
  assert.equal(run('shiftMonth("9999-12",1)'),'9999-12');
});

test('Formato monetario: conserva centavos y signo en montos pequeños y totales grandes',()=>{
  const {run}=app();
  assert.equal(run('money(-1)'),'-$0.01');
  assert.equal(run('money(30)'),'$0.30');
  assert.equal(run('money(9007199254740991)'),'$90,071,992,547,409.91');
  assert.equal(run('money(-9007199254740991)'),'-$90,071,992,547,409.91');
});

test('Integridad: referencias, IDs, clasificación de categoría y tipo de movimiento',()=>{
  const {run}=app();run(fixture);
  run('data.movements=[movement("expense",5000,food.id)]');
  assert.equal(run('validateData(data)'),true);
  for(const mutation of ['candidate.movements[0].accountId="no-existe"','candidate.movements[0].categoryId="no-existe"','candidate.movements[0].categoryId=salary.id','candidate.movements[0].classification=null','candidate.movements[0].classification="verde"','delete candidate.categories[0].classification','candidate.categories[0].classification="azul"','candidate.categories.find(c=>c.type==="income").classification=null','candidate.movements[0].amount=0','candidate.movements[0].amount=-100','candidate.movements[0].amount=NaN','candidate.movements[0].amount=Infinity','candidate.movements.push({...candidate.movements[0]})','candidate.accounts.push({...candidate.accounts[0]})','candidate.categories.push({...candidate.categories[0]})']) assert.equal(run(`(()=>{const candidate=JSON.parse(JSON.stringify(data));${mutation};return validateData(candidate)})()`),false,mutation);
});

test('Almacenamiento corrupto: no se sobrescribe hasta un reinicio explícito',()=>{
  const saved=new Map([['suma.finanzas.v1','{datos rotos']]);
  const {run}=app(saved);
  assert.equal(run('validateData(data)'),true);
  assert.equal(run('storageLocked'),true);
  assert.equal(run('commit(freshData()).ok'),false);
  assert.equal(saved.get('suma.finanzas.v1'),'{datos rotos');
  assert.equal(run('commit(freshData(),{replaceUnreadable:true}).ok'),true);
  assert.equal(run('storageLocked'),false);
});

test('Almacenamiento lleno/bloqueado: el cambio no se aplica ni se anuncia como guardado',()=>{
  const {run}=app(new Map(),{failWrite:true});run(fixture);
  assert.equal(run('commit({...data,movements:[movement("income",10000,salary.id)]}).ok'),false);
  assert.equal(run('data.movements.length'),0);
  assert.match(run('storageProblem'),/No se pudo guardar/);
});

test('Ejemplo: ambos meses, balance positivo/negativo y todas las relaciones válidas',()=>{
  const {run}=app();
  assert.equal(run('validateData(demoData("2026-10"))'),true);
  assert.equal(run('demoData("2026-10").movements.length'),20);
  assert.ok(run('monthSummary(demoData("2026-10"),"2026-10").balance')>0);
  assert.equal(run('monthSummary(demoData("2026-10"),"2026-09").balance'),-360000);
});

test('Nombres personalizados: normalización para duplicados y escape de contenido HTML',()=>{
  const {run}=app();
  assert.equal(run('normalizeName("  NÓMINA   personal ")'),'nomina personal');
  assert.equal(run('escapeHtml("<img src=x onerror=alert(1)>")'),'&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(run(`escapeHtml(${JSON.stringify('"\u0027&')})`),'&quot;&#39;&amp;');
});

test('1 y 2: dos gastos heredan Amarillo; cambiar la categoría a Rojo actualiza ambos sin cambiar saldos',()=>{
  const first=app();first.run(fixture);
  first.run('const pets={id:uid(),name:"Mascotas",type:"expense",custom:true,classification:"amarillo"}; data.categories.push(pets); data.movements=[movement("expense",25010,pets.id),movement("expense",17525,pets.id,bank.id,"2026-09-15")]');
  assert.equal(first.run('(renderMovementTable(data.movements).match(/class="badge amarillo"/g)||[]).length'),2);
  const movements=first.run('JSON.stringify(data.movements)');
  const balances=first.run('JSON.stringify(accountBalances())');
  assert.equal(first.run('setCategoryClassification(pets.id,"rojo").ok'),true);
  assert.equal(first.run('(renderMovementTable(data.movements).match(/class="badge rojo"/g)||[]).length'),2);
  assert.equal(first.run('JSON.stringify(data.movements)'),movements);
  assert.equal(first.run('JSON.stringify(accountBalances())'),balances);
  assert.equal(first.run('data.movements.some(m=>"classification" in m)'),false);
  const second=app(first.saved);
  assert.equal(second.run('data.categories.find(c=>c.name==="Mascotas").classification'),'rojo');
  assert.equal(second.run('(renderMovementTable(data.movements).match(/class="badge rojo"/g)||[]).length'),2);
});

test('3: dona y leyenda ordenan por monto, conservando Rojo, Verde, Amarillo, Rojo por categoría',()=>{
  const {run}=app();run(fixture);
  run(`
    const entries=[['Despensa',400000,'verde'],['Alimentación fuera de casa',600000,'rojo'],['Regalos',200000,'amarillo'],['Gastos hormiga',100000,'rojo']];
    for(const [name,amount,classification] of entries){const category=data.categories.find(c=>c.name===name);category.classification=classification;data.movements.push(movement('expense',amount,category.id));}
    const breakdown=categoryBreakdown(monthSummary(data,'2026-10').movements);
    const donut=renderExpenseDonut(breakdown);
    const detail=renderDetail(monthSummary(data,'2026-10'),'expense');
  `);
  assert.deepEqual(JSON.parse(run('JSON.stringify(breakdown.map(c=>c.name))')),['Alimentación fuera de casa','Despensa','Regalos','Gastos hormiga']);
  assert.deepEqual(JSON.parse(run('JSON.stringify(breakdown.map(c=>c.classification))')),['rojo','verde','amarillo','rojo']);
  const donut=run('donut');
  const slices=[...donut.matchAll(/<circle data-category-id="([^"]+)"[^>]+stroke="([^"]+)"[^>]+stroke-dasharray="([^"]+)"/g)];
  assert.equal(slices.length,4);
  assert.deepEqual(slices.map(match=>match[2]),['#ab3e43','#28714c','#c28b14','#ab3e43']);
  assert.equal(new Set(slices.map(match=>match[1])).size,4);
  assert.ok(Math.abs(slices.reduce((sum,match)=>sum+Number(match[3].split(' ')[0]),0)-100)<1e-10);
  const legend=run('detail').split('<div class="legend">')[1].split('<p class="chart-caption">')[0];
  const names=['Alimentación fuera de casa','Despensa','Regalos','Gastos hormiga'];
  for(let index=1;index<names.length;index++)assert.ok(legend.indexOf(names[index])>legend.indexOf(names[index-1]));
  assert.equal(run('monthSummary(data,"2026-10").expense'),1300000);
});

test('6: sin gastos no hay dona; una categoría ocupa 100 % sin separadores',()=>{
  const {run}=app();run(fixture);
  assert.equal(run('renderExpenseDonut([])'),'');
  assert.match(run('renderDetail(monthSummary(data,"2026-10"),"expense")'),/Aún no hay gastos/);
  assert.doesNotMatch(run('renderDetail(monthSummary(data,"2026-10"),"expense")'),/class="donut"/);
  run('food.classification="verde";data.movements=[movement("expense",10000,food.id),movement("expense",20000,food.id)]');
  const svg=run('renderExpenseDonut(categoryBreakdown(data.movements))');
  assert.equal((svg.match(/<circle /g)||[]).length,1);
  assert.equal((svg.match(/<line /g)||[]).length,0);
  assert.match(svg,/stroke-dasharray="100 0"/);
  assert.match(svg,/stroke="#28714c"/);
});

test('6: categorías contiguas con el mismo color conservan rebanadas y límites independientes',()=>{
  const {run}=app();run(fixture);
  run('data.movements=data.categories.slice(0,3).map((c,index)=>{c.classification="amarillo";return movement("expense",(index+1)*10000,c.id)})');
  const svg=run('renderExpenseDonut(categoryBreakdown(data.movements))');
  assert.equal((svg.match(/<circle /g)||[]).length,3);
  assert.equal((svg.match(/<line /g)||[]).length,3);
  assert.equal((svg.match(/stroke="#c28b14"/g)||[]).length,3);
  assert.equal(new Set([...svg.matchAll(/stroke-dashoffset="([^"]+)"/g)].map(match=>match[1])).size,3);
});

test('Sin clasificar: gasto válido, distintivo explícito y rebanada gris; ingresos sin clasificación',()=>{
  const {run}=app();run(fixture);
  run('data.movements=[movement("expense",12345,food.id)]');
  assert.equal(run('validateData(data)'),true);
  assert.match(run('renderMovementTable(data.movements)'),/badge unclassified[^>]*>Sin clasificar/);
  assert.match(run('renderExpenseDonut(categoryBreakdown(data.movements))'),/stroke="#a1aab6"/);
  for(const invalid of ['azul','','morado',null])assert.equal(run(`setCategoryClassification(food.id,${JSON.stringify(invalid)}).ok`),false);
  assert.equal(run('setCategoryClassification(salary.id,"rojo").ok'),false);
  assert.equal(run('"classification" in salary'),false);
  assert.equal(run('setCategoryClassification(food.id,"verde").ok'),true);
  assert.match(run('renderExpenseDonut(categoryBreakdown(data.movements))'),/stroke="#28714c"/);
});

test('5: crear, editar de monto/categoría/cuenta/mes/tipo y eliminar conserva la lógica financiera',()=>{
  const {run}=app();run(fixture);
  run('bank.opening=1000000;food.classification="verde";const gifts=data.categories.find(c=>c.name==="Regalos");gifts.classification="amarillo"');
  assert.equal(run('commit({...data,movements:[movement("expense",200000,food.id)]}).ok'),true);
  assert.equal(run('monthSummary(data,"2026-10").total'),800000);
  assert.equal(run('commit({...data,movements:data.movements.map(m=>({...m,amount:50000,categoryId:gifts.id,accountId:cash.id,date:"2026-09-10"}))}).ok'),true);
  assert.equal(run('monthSummary(data,"2026-10").expense'),0);
  assert.equal(run('monthSummary(data,"2026-09").expense'),50000);
  assert.equal(run('accountBalances().find(a=>a.id===cash.id).balance'),-50000);
  assert.match(run('renderMovementTable(data.movements)'),/badge amarillo/);
  assert.equal(run('commit({...data,movements:data.movements.map(m=>({...m,type:"income",categoryId:salary.id}))}).ok'),true);
  assert.equal(run('monthSummary(data,"2026-09").income'),50000);
  assert.doesNotMatch(run('renderMovementTable(data.movements)'),/class="badge/);
  assert.equal(run('commit({...data,movements:[]}).ok'),true);
  assert.equal(run('monthSummary(data,"2026-09").total'),1000000);
});

function legacyFixture() {
  const {run}=app();
  const source=JSON.parse(run('JSON.stringify(demoData("2026-10"))'));
  source.version=1;
  source.categories.forEach(category=>delete category.classification);
  source.movements.forEach((movement,index)=>movement.classification=movement.type==='expense'?(index%2?'verde':'rojo'):null);
  source.accounts.push({id:'cuenta-personal',name:'Personal',opening:125010});
  source.categories.push({id:'categoria-personal',name:'Mascotas',type:'expense',custom:true});
  source.movements.push({id:'movimiento-personal',type:'expense',amount:1515,categoryId:'categoria-personal',accountId:'cuenta-personal',date:'2026-10-20',description:'Registro original con decimales',classification:'amarillo'});
  return source;
}

test('Migración v1 → v2: conserva todos los registros y una copia exacta; no infiere colores antiguos',()=>{
  const legacy=legacyFixture(),raw=JSON.stringify(legacy);
  const saved=new Map([['suma.finanzas.v1',raw]]);
  const {run}=app(saved);
  assert.equal(run('data.version'),2);
  assert.equal(run('validateData(data)'),true);
  assert.equal(saved.get('suma.finanzas.backup-v1'),raw);
  const migrated=JSON.parse(saved.get('suma.finanzas.v1'));
  assert.deepEqual(migrated.accounts,legacy.accounts);
  assert.deepEqual(migrated.movements,legacy.movements.map(({classification,...rest})=>rest));
  assert.deepEqual(migrated.categories,legacy.categories.map(category=>category.type==='expense'?{...category,classification:null}:category));
  assert.equal(run('data.movements.length'),21);
  assert.equal(run('data.categories.filter(c=>c.type==="expense").every(c=>c.classification===null)'),true);
  const legacyBalance=legacy.accounts.reduce((sum,a)=>sum+a.opening,0)+legacy.movements.reduce((sum,m)=>sum+(m.type==='income'?m.amount:-m.amount),0);
  assert.equal(run('monthSummary(data,"2026-10").total'),legacyBalance);
  assert.equal(run('migrateLegacyData(data)===data'),true);
  const persisted=saved.get('suma.finanzas.v1');
  const second=app(saved);
  assert.equal(second.run('data.movements.length'),21);
  assert.equal(saved.get('suma.finanzas.v1'),persisted);
  assert.equal(saved.get('suma.finanzas.backup-v1'),raw);
});

test('Migración sin espacio para copia: conserva el original y carga todos los registros en memoria',()=>{
  const raw=JSON.stringify(legacyFixture()),saved=new Map([['suma.finanzas.v1',raw]]);
  const {run}=app(saved,{failWrite:true});
  assert.equal(run('data.version'),2);
  assert.equal(run('data.movements.length'),21);
  assert.equal(run('storageLocked'),false);
  assert.match(run('storageProblem'),/no se pudo guardar la migración/);
  assert.equal(saved.get('suma.finanzas.v1'),raw);
  assert.equal(saved.has('suma.finanzas.backup-v1'),false);
  assert.equal(run('commit(data).ok'),false);
  assert.equal(saved.get('suma.finanzas.v1'),raw);
});

test('Migración con fallo al guardar v2: copia intacta y reintento posterior seguro',()=>{
  const raw=JSON.stringify(legacyFixture()),saved=new Map([['suma.finanzas.v1',raw]]);
  const options={failKey:'suma.finanzas.v1'};
  const {run}=app(saved,options);
  assert.equal(saved.get('suma.finanzas.v1'),raw);
  assert.equal(saved.get('suma.finanzas.backup-v1'),raw);
  assert.equal(run('data.movements.length'),21);
  options.failKey=null;
  assert.equal(run('commit(data).ok'),true);
  assert.equal(JSON.parse(saved.get('suma.finanzas.v1')).version,2);
  assert.equal(saved.get('suma.finanzas.backup-v1'),raw);
});

test('Migración rechaza datos v1 inválidos sin reemplazar ni copiar información corrupta',()=>{
  const legacy=legacyFixture();legacy.movements[0].accountId='no-existe';
  const raw=JSON.stringify(legacy),saved=new Map([['suma.finanzas.v1',raw]]);
  const {run}=app(saved);
  assert.equal(run('storageLocked'),true);
  assert.equal(saved.get('suma.finanzas.v1'),raw);
  assert.equal(saved.has('suma.finanzas.backup-v1'),false);
});

test('El reinicio confirmado también elimina la copia de migración del almacenamiento local',()=>{
  const saved=new Map([['suma.finanzas.v1',JSON.stringify(legacyFixture())]]);
  const {run}=app(saved);
  assert.equal(saved.has('suma.finanzas.backup-v1'),true);
  assert.equal(run('commit(freshData(),{replaceUnreadable:true}).ok'),true);
  assert.equal(saved.has('suma.finanzas.backup-v1'),false);
  assert.equal(run('data.movements.length'),0);
  assert.equal(run('validateData(data)'),true);
});

test('Una clasificación fallida al guardar no cambia colores ni movimientos existentes',()=>{
  const {run}=app(new Map(),{failWrite:true});run(fixture);
  run('food.classification="amarillo";data.movements=[movement("expense",5000,food.id)]');
  assert.equal(run('setCategoryClassification(food.id,"rojo").ok'),false);
  assert.equal(run('data.categories.find(c=>c.id===food.id).classification'),'amarillo');
  assert.match(run('renderMovementTable(data.movements)'),/badge amarillo/);
});
