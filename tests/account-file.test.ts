import test from'node:test';import assert from'node:assert/strict';import{parseLocalAccount}from'../packages/cloud/account-file.ts';
test('comment between legacy account values never becomes a password',()=>{
 const a=parseLocalAccount('CN service:\naccounts: [\n{\n"test@example.test",\n// current operator note\n"fake-pass"\n}\n]\nother-token:"must-not-be-read"');
 assert.deepEqual(a,{email:'test@example.test',password:'fake-pass'});
});
test('quoted slashes, brackets and escaped quotes survive comment parsing',()=>{
 const password='fake//[value]"\\end';assert.equal(parseLocalAccount('accounts: ["test@example.test", '+JSON.stringify(password)+']').password,password);
});
test('JSON account objects work and malformed or ambiguous files fail closed',()=>{
 assert.equal(parseLocalAccount('[{"email":"test@example.test","password":"fake"}]').password,'fake');
 for(const text of ['accounts: ["test@example.test", // no password\n]', '["test@example.test","fake","extra"]','["test@example.test", "unterminated]', 'outside-token:"fake"'])assert.throws(()=>parseLocalAccount(text),/CLOUD_CREDENTIAL_FORMAT_INVALID/);
});
