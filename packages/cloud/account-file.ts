// Operator's legacy `accounts: [ { "email", // comment, "password" } ]`
// is not valid JSON. Read quoted values within the bounded accounts section,
// ignoring comments without changing // or brackets inside quoted passwords.
export function parseLocalAccount(text:string){
 const marker=/^\s*accounts\s*:\s*\[/m.exec(text);
 const start=marker?marker.index+marker[0].lastIndexOf('['):text.indexOf('[');
 if(start<0)throw Error('CLOUD_CREDENTIAL_FORMAT_INVALID');
 let depth=0,string=false,escape=false,line=false,block=false,quoted='',clean='';const values:string[]=[];
 for(let i=start;i<text.length;i++){
  const c=text[i],next=text[i+1];
  if(line){if(c==='\n'||c==='\r'){line=false;clean+='\n';}continue;}
  if(block){if(c==='*'&&next==='/'){block=false;i++;clean+=' ';}continue;}
  if(string){clean+=c;quoted+=c;if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"'){string=false;try{values.push(JSON.parse(quoted));}catch{throw Error('CLOUD_CREDENTIAL_FORMAT_INVALID');}}continue;}
  if(c==='/'&&next==='/'){line=true;i++;continue;}
  if(c==='/'&&next==='*'){block=true;i++;continue;}
  clean+=c;
  if(c==='"'){string=true;quoted='"';continue;}
  if(c==='[')depth++;
  if(c===']'&&--depth===0){
   let pair:unknown=values;
   try{const parsed=JSON.parse(clean);if(Array.isArray(parsed)&&parsed.length===1&&parsed[0]&&typeof parsed[0]==='object')pair=[parsed[0].email,parsed[0].password];else pair=parsed;}catch{/* Retain the original two-value pseudo-object format. */}
   if(!Array.isArray(pair)||pair.length!==2||typeof pair[0]!=='string'||typeof pair[1]!=='string'||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(pair[0])||!pair[1])throw Error('CLOUD_CREDENTIAL_FORMAT_INVALID');
   return {email:pair[0],password:pair[1]};
  }
 }
 throw Error('CLOUD_CREDENTIAL_FORMAT_INVALID');
}
