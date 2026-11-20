import { describe,expect,it } from 'vitest';
import { validateBackup,dataUrlToBlob } from './backup';
const date='2026-11-19T00:00:00.000Z';
describe('backup validation',()=>{
 it('accepts empty library',()=>expect(validateBackup({app:'Prompt Cloud',schemaVersion:1,exportedAt:date,categories:[],prompts:[]}).prompts).toEqual([]));
 it('rejects unsupported versions',()=>expect(()=>validateBackup({app:'Prompt Cloud',schemaVersion:2,exportedAt:date,categories:[],prompts:[]})).toThrow());
 it('rejects missing category relations',()=>expect(()=>validateBackup({app:'Prompt Cloud',schemaVersion:1,exportedAt:date,categories:[],prompts:[{id:'p',categoryId:'missing',title:'t',content:'',images:[],createdAt:date,updatedAt:date}]})).toThrow());
 it('preserves mixed text exactly',()=>{const content='العربية\n{"hello":"world"}\n<code> & https://example.com';const b=validateBackup({app:'Prompt Cloud',schemaVersion:1,exportedAt:date,categories:[{id:'c',name:'اختبار',createdAt:date,updatedAt:date}],prompts:[{id:'p',categoryId:'c',title:'t',content,images:[],createdAt:date,updatedAt:date}]});expect(b.prompts[0].content).toBe(content)});
 it('converts base64 image to Blob',()=>expect(dataUrlToBlob('data:image/png;base64,aGVsbG8=','image/png').size).toBe(5));
});
