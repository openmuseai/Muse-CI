// MCP App frames deliberately omit allow-forms. Keep forms local: validate,
// dispatch our existing submit handlers, and never invoke browser navigation.
(function(){
'use strict';
function submit(form,event){event.preventDefault();if(form.reportValidity())form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));}
document.addEventListener('click',event=>{const button=event.target.closest('button,input[type="submit"]');if(button&&!button.disabled&&button.type==='submit'&&button.form)submit(button.form,event);},true);
document.addEventListener('keydown',event=>{if(event.key!=='Enter'||event.isComposing||event.defaultPrevented)return;const input=event.target;if(input.tagName==='INPUT'&&input.form&&!['button','submit','reset','checkbox','radio','file'].includes(input.type))submit(input.form,event);},true);
})();
