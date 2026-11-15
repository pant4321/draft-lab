// Noninteractive popup clicks should not blur focus onto the page behind it.
export function retainPopupFocus(popup,cancelHide) {
 popup.addEventListener('pointerdown',event=>{
  cancelHide();
  const control=event.target.closest('button,input,select,textarea,a[href],[tabindex]');
  if(control&&control!==popup)return;
  event.preventDefault();
  popup.focus({preventScroll:true});
 });
}

export function dismissOnBackdrop(dialog,dismiss) {
 const outside=event=>{
  if(event.target!==dialog)return false;
  const bounds=dialog.getBoundingClientRect();
  return event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;
 };
 let pressedBackdrop=false;
 dialog.addEventListener('pointerdown',event=>{pressedBackdrop=outside(event);});
 dialog.addEventListener('pointercancel',()=>{pressedBackdrop=false;});
 dialog.addEventListener('click',event=>{
  const dismissNow=pressedBackdrop&&outside(event);
  pressedBackdrop=false;
  if(dismissNow)dismiss();
 });
 dialog.addEventListener('close',()=>{pressedBackdrop=false;});
}
