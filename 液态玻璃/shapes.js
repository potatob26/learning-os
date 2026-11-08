function initShapeControls({glass,stage,update,center}){
  const $=id=>document.getElementById(id),editor=$('outline-editor'),nodes=$('editor-nodes');
  const names={rounded:'圆角矩形',ellipse:'圆形 / 椭圆',capsule:'胶囊',diamond:'菱形',hexagon:'六边形',star:'星形',custom:'自定义轮廓'};
  let points=pointsForShape('custom'),selected=0,drag=null;
  const serialize=()=>points.map(p=>p.map(n=>Math.round(n*10)/10).join(',')).join(' ');
  function fit(){
    for(const id of ['width','height']){
      const input=$(id),max=Math.max(120,Math.min(420,(id==='width'?stage.clientWidth:stage.clientHeight)-24));
      input.max=Math.floor(max);input.value=Math.min(Number(input.value),max);update(id);
    }
    $('radius').max=Math.floor(Math.min(glass.width,glass.height)/2);
    update('radius');glass.setPosition(glass._x,glass._y);
    const compact=glass.height<190||glass.width<190;
    glass.classList.toggle('compact-content',compact);
  }
  function refreshEditor(rebuild=false){
    $('editor-outline').setAttribute('d','M'+points.map(p=>p.join(',')).join(' L')+' Z');
    if(rebuild){
      nodes.replaceChildren(...points.map((_,i)=>{
        const node=document.createElementNS('http://www.w3.org/2000/svg','circle');
        node.dataset.index=i;node.setAttribute('r','3');node.setAttribute('tabindex','0');node.setAttribute('role','button');return node;
      }));
    }
    [...nodes.children].forEach((node,i)=>{
      node.setAttribute('cx',points[i][0]);node.setAttribute('cy',points[i][1]);
      node.setAttribute('aria-label',`顶点 ${i+1}，横坐标 ${Math.round(points[i][0])}，纵坐标 ${Math.round(points[i][1])}`);
      node.classList.toggle('selected',i===selected);
    });
    $('point-count').textContent=`${points.length} / 12`;
    $('point-add').disabled=points.length>=12;$('point-remove').disabled=points.length<=3;
    if(glass.shape==='custom')glass.setAttribute('points',serialize());
  }
  function status(text){$('editor-status').textContent=text;}
  function changePoint(index,x,y){
    const next=points.map(p=>[...p]);next[index]=[Math.max(3,Math.min(97,x)),Math.max(3,Math.min(97,y))];
    if(!validPolygon(next)){status('边线不能交叉，已保留上一个有效轮廓。');return;}
    points=next;refreshEditor();status(`已选顶点 ${index+1} · ${Math.round(points[index][0])}, ${Math.round(points[index][1])}`);
  }
  function choose(shape,applyDimensions=true){
    if(shape==='custom')glass.setAttribute('points',serialize());
    glass.setAttribute('shape',shape);
    document.querySelectorAll('[data-shape]').forEach(b=>{const active=b.dataset.shape===shape;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    $('shape-name').textContent=names[shape];$('custom-editor').hidden=shape!=='custom';
    $('radius-control').hidden=shape!=='rounded';
    if(applyDimensions){
      if(shape==='capsule'){$('width').value=320;$('height').value=160;}
      else if(shape==='ellipse'){$('height').value=$('width').value;}
    }
    fit();if(shape==='custom')refreshEditor(true);if(applyDimensions)center();
  }
  document.querySelectorAll('[data-shape]').forEach(b=>b.addEventListener('click',()=>choose(b.dataset.shape)));
  editor.addEventListener('pointerdown',e=>{
    const node=e.target.closest('[data-index]');if(!node||e.button!==0)return;
    selected=Number(node.dataset.index);drag={index:selected,id:e.pointerId};
    node.focus();editor.setPointerCapture(e.pointerId);refreshEditor();status(`已选顶点 ${selected+1}`);e.preventDefault();
  });
  editor.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const r=editor.getBoundingClientRect();changePoint(drag.index,(e.clientX-r.left)/r.width*100,(e.clientY-r.top)/r.height*100);
  });
  for(const event of ['pointerup','pointercancel','lostpointercapture'])editor.addEventListener(event,()=>{drag=null;});
  nodes.addEventListener('focusin',e=>{if(e.target.dataset.index!==undefined){selected=Number(e.target.dataset.index);refreshEditor();status(`已选顶点 ${selected+1}`);}});
  nodes.addEventListener('keydown',e=>{
    const i=Number(e.target.dataset.index),move={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];
    if(!move||!Number.isInteger(i))return;e.preventDefault();selected=i;const step=e.shiftKey?5:1;
    changePoint(i,points[i][0]+move[0]*step,points[i][1]+move[1]*step);
  });
  $('point-add').onclick=()=>{
    if(points.length>=12)return;const a=points[selected],b=points[(selected+1)%points.length];
    const next=points.map(p=>[...p]);next.splice(selected+1,0,[(a[0]+b[0])/2,(a[1]+b[1])/2]);
    if(!validPolygon(next)){status('这条边太短，请选择另一顶点后加点。');return;}
    points=next;selected++;refreshEditor(true);nodes.children[selected].focus();status(`已添加顶点 ${selected+1}`);
  };
  $('point-remove').onclick=()=>{
    if(points.length<=3)return;const next=points.filter((_,i)=>i!==selected);
    if(!validPolygon(next)){status('删除后边线会交叉，请先调整相邻顶点。');return;}
    points=next;selected=Math.min(selected,points.length-1);refreshEditor(true);nodes.children[selected].focus();status(`已删除顶点，剩余 ${points.length} 个`);
  };
  $('copy-config').onclick=async()=>{
    const shape=glass.shape,custom=shape==='custom'?`\n  points="${serialize()}"`:'';
    const code=`<liquid-glass width="${glass.width}" height="${glass.height}"\n  shape="${shape}" radius="${glass.radius}"${custom}\n  refraction="${glass.getAttribute('refraction')}" blur="${glass.getAttribute('blur')}"${glass.hasAttribute('chromatic')?' chromatic':''}>\n  你的内容\n</liquid-glass>`;
    try{await navigator.clipboard.writeText(code);$('copy-status').textContent='已复制当前形状和材质参数。';}
    catch{$('copy-status').textContent='请手动选择并复制下方代码：';const pre=document.createElement('pre');pre.textContent=code;$('copy-status').append(pre);}
  };
  function reset(){points=pointsForShape('custom');selected=0;$('width').value=240;$('height').value=240;$('radius').max=120;$('radius').value=64;choose('rounded',false);status('已选顶点 1');}
  choose('rounded',false);refreshEditor(true);
  return {fit,reset};
}
globalThis.initShapeControls=initShapeControls;
