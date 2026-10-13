import type { Env } from './types';
export class BusyError extends Error { constructor(){super('Another operation is in progress. Try again shortly.');} }
export class LeaseLostError extends Error {}
export class Lease {
 constructor(readonly env:Env,readonly token:string){}
 async assert(){const row=await this.env.DB.prepare('SELECT id FROM settings WHERE id=1 AND lease_token=? AND lease_until>?').bind(this.token,Date.now()).first();if(!row)throw new LeaseLostError('Operation lease expired.');}
 guard(){return `EXISTS(SELECT 1 FROM settings WHERE id=1 AND lease_token='${this.token}' AND lease_until>${Date.now()})`;}
}
export async function withLease<T>(env:Env,fn:(lease:Lease)=>Promise<T>):Promise<T>{
 const token=crypto.randomUUID(); const now=Date.now();
 const row=await env.DB.prepare('UPDATE settings SET lease_token=?,lease_until=? WHERE id=1 AND lease_until<=? RETURNING id').bind(token,now+120000,now).first();if(!row)throw new BusyError();
 try{return await fn(new Lease(env,token));}finally{await env.DB.prepare('UPDATE settings SET lease_token=NULL,lease_until=0 WHERE id=1 AND lease_token=?').bind(token).run();}
}
