import test from 'node:test';
import assert from 'node:assert/strict';
import {retainPopupFocus,dismissOnBackdrop} from '../dist/overlays.mjs';

function surface(){
 const listeners={};
 return {focusCalls:[],
  addEventListener(type,handler){(listeners[type]??=[]).push(handler);},
  focus(options){this.focusCalls.push(options);},
  getBoundingClientRect(){return {left:100,right:500,top:100,bottom:400};},
  fire(type,{target=this,...values}={}){
   const event={target,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...values};
   for(const listener of listeners[type]??[])listener(event);
   return event;
  }
 };
}

test('graph clicks cancel dismissal and prevent the focus loss that closes the popup',()=>{
 const popup=surface();let hidePending=true;
 retainPopupFocus(popup,()=>{hidePending=false;});
 const graph={closest(){return popup;}}; // Graph ancestors include the focusable popup.
 const event=popup.fire('pointerdown',{target:graph});
 assert.equal(hidePending,false);assert.equal(event.defaultPrevented,true);
 assert.deepEqual(popup.focusCalls,[{preventScroll:true}]);
});

test('popup selectors and buttons retain their native pointer behavior',()=>{
 const popup=surface();let cancellations=0;
 retainPopupFocus(popup,()=>{cancellations++;});
 for(const name of ['select','button','input']){
  const control={name,closest(){return this;}};
  assert.equal(popup.fire('pointerdown',{target:control}).defaultPrevented,false);
 }
 assert.equal(cancellations,3);assert.deepEqual(popup.focusCalls,[]);
});

test('picker backdrop dismisses, while content, padding, and drags out of the picker do not',()=>{
 const dialog=surface();let closed=0;dismissOnBackdrop(dialog,()=>{closed++;});
 const point=(clientX,clientY,target=dialog)=>({clientX,clientY,target});
 const click=(down,up=down)=>{dialog.fire('pointerdown',down);dialog.fire('click',up);};
 const search={};
 click(point(150,150,search)); // Search field.
 click(point(110,110)); // Dialog padding is not its backdrop.
 click(point(100,100)); // Border is inside.
 click(point(150,150,search),point(20,20)); // Dragging from content must not dismiss.
 click(point(20,20),point(150,150,search)); // Dragging inward must not dismiss either.
 assert.equal(closed,0);
 click(point(20,20));assert.equal(closed,1);
 // A click without a matching backdrop press cannot reuse a previous dismissal.
 dialog.fire('click',point(20,20));assert.equal(closed,1);
 dialog.fire('pointerdown',point(20,20));dialog.fire('pointercancel');
 dialog.fire('click',point(20,20));assert.equal(closed,1);
 dialog.fire('pointerdown',point(20,20));dialog.fire('close');
 dialog.fire('click',point(20,20));assert.equal(closed,1);
 click(point(550,450));assert.equal(closed,2);
});
