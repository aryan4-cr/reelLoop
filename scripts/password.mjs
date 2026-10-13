import { pbkdf2Sync,randomBytes } from 'node:crypto';
import readline from 'node:readline';
const rl=readline.createInterface({input:process.stdin,output:process.stdout});
console.log('Generate OWNER_PASSWORD_HASH locally; paste the result into .dev.vars or Wrangler secret input.');
const password=await new Promise(resolve=>{ process.stdout.write('Owner password (input hidden): ');const stdin=process.stdin; if(stdin.isTTY){stdin.setRawMode(true);let s='';const onData=b=>{const c=b.toString();if(c==='\r'||c==='\n'){stdin.setRawMode(false);stdin.off('data',onData);process.stdout.write('\n');resolve(s);}else if(c==='\u0003'){process.exit(1);}else if(c==='\u007f'||c==='\b'){s=s.slice(0,-1);}else{s+=c;}};rl.pause();stdin.resume();stdin.on('data',onData);}else{rl.once('line',resolve);} });
rl.close();if(String(password).length<14)throw new Error('Use at least 14 characters.');const salt=randomBytes(16).toString('hex');console.log(`pbkdf2$100000$${salt}$${pbkdf2Sync(String(password),salt,100000,32,'sha256').toString('hex')}`);
