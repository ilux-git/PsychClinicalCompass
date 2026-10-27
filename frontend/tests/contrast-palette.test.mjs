// Numeric token regressions complement axe on rendered role pages; neither proves full WCAG conformance.
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';

const read = name => readFileSync(new URL('../src/'+name,import.meta.url),'utf8');
const declarations = block => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(match=>[match[1],match[2].trim()]));
const light = declarations(read('workspace.css').match(/:root\s*\{([^}]+)\}/)[1]);
const dark = {...light,...declarations(read('telegram.css').match(/\.telegram-app\[data-telegram-theme="dark"\]\s*\{([^}]+)\}/)[1])};
const resolve = (value,tokens) => value.startsWith('var(') ? resolve(tokens[value.slice(4,-1)],tokens) : value;
const luminance = value => {
  let hex = value.slice(1);
  if(hex.length===3)hex=[...hex].map(c=>c+c).join('');
  assert.match(hex,/^[0-9a-f]{6}$/i,'Contrast pairs must resolve to opaque RGB colors');
  const linear=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  return linear.reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
};
const ratio = (foreground,background) => {
  const a=luminance(foreground),b=luminance(background);
  return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
};
const check = (tokens,foreground,background,minimum=4.5) => {
  const foregroundColor=resolve(tokens[foreground],tokens),backgroundColor=resolve(tokens[background],tokens);
  const actual=ratio(foregroundColor,backgroundColor);
  assert.ok(actual>=minimum,`${foreground}/${background}: ${actual.toFixed(3)} < ${minimum}`);
};

for(const [name,tokens] of [['light',light],['dark',dark]]) {
  test(`${name}: primary, secondary and field text remain readable on every shared surface`,()=>{
    for(const background of ['--surface','--paper','--surface-alt','--signal-soft','--info-soft','--success-soft','--warning-soft','--danger-soft']) {
      check(tokens,'--ink',background);
      check(tokens,'--muted',background);
    }
    check(tokens,'--placeholder','--surface');
    check(tokens,'--field-border','--surface',3);
    check(tokens,'--focus-ring','--paper',3);
    check(tokens,'--chart-line','--surface',3);
  });
  test(`${name}: action, hover, pressed, disabled and status pairs retain contrast`,()=>{
    for(const background of ['--button-bg','--button-hover','--button-active'])check(tokens,'--button-ink',background);
    check(tokens,'--control-muted-ink','--control-muted-bg');
    check(tokens,'--on-accent','--signal-dark');
    for(const tone of ['info','success','warning','danger'])check(tokens,`--${tone}-ink`,`--${tone}-soft`);
  });
}

test('light plates on calendar artwork use fixed dark text, independently of the host theme',()=>{
  assert.ok(ratio('#18191a','#ffffff')>=7);
  assert.ok(ratio('#49534d','#ffffff')>=4.5);
});
