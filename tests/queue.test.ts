import { describe,it,expect } from 'vitest';
import { selectNext,nextSlot,upcoming } from '../worker/queue';
import { uploadSchema } from '../worker/validation';
import type { Settings,Video } from '../worker/types';
const s={enabled:0,interval_minutes:180,cooldown_minutes:0,mode:'loop',last_video_id:null,cursor_position:-1,next_publish_at:0} as Settings;
const video=(id:string,position:number)=>({id,name:id,position,enabled:1,status:'ready',last_published_at:null,publish_count:0} as Video);
describe('queue and schedule',()=>{
 it('defaults to a three-hour schedule and wraps eight videos',()=>{const rows=upcoming(Array.from({length:8},(_,i)=>video(String(i),i)),s,0,10);expect(rows.map(v=>v.id)).toEqual(['0','1','2','3','4','5','6','7','0','1']);expect(rows[1].at).toBe(10800000);});
 it('survives deletion, disabling and reordering',()=>{const v=[video('a',0),video('c',2)];expect(selectNext(v,{...s,last_video_id:'b',cursor_position:1},0)?.id).toBe('c');v[1].enabled=0;expect(selectNext(v,{...s,cursor_position:1},0)?.id).toBe('a');});
 it('skips missed slots instead of publishing a burst',()=>expect(nextSlot(0,12*3600000,180)).toBe(15*3600000));
 it('honors once mode and repeat cooldowns',()=>{const v=video('a',0);v.publish_count=1;v.last_published_at=0;expect(selectNext([v],{...s,mode:'once'},9999999)).toBeUndefined();expect(selectNext([v],{...s,cooldown_minutes:60},1000)).toBeUndefined();});
 it('rejects invalid uploads',()=>{expect(uploadSchema.safeParse({name:'bad.exe',content_type:'video/mp4',size_bytes:1,duration_seconds:5,width:1080,height:1920}).success).toBe(false);});
});
