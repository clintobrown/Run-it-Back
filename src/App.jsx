import { useState, useCallback, useEffect } from "react";

const ALL_POS = ['SB','BB','UTG','MP','LJ','HJ','CO','BTN'];
const PRE_ORD  = ['UTG','MP','LJ','HJ','CO','BTN','SB','BB'];
const POST_ORD = ['SB','BB','UTG','MP','LJ','HJ','CO','BTN'];
const SUITS = [
  { id:'h', sym:'♥', bg:'#c62828' },
  { id:'d', sym:'♦', bg:'#1565c0' },
  { id:'c', sym:'♣', bg:'#1a6b2a' },
  { id:'s', sym:'♠', bg:'#222222' },
];
const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
const STREETS = ['preflop','flop','turn','river'];
const STORAGE_KEY = 'poker_hand_history_v3';

function loadHistory(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); }catch{ return []; } }
function saveHistory(h){ try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(h)); }catch{} }

function mkState(){
  const hands={}, stacks={}, contributed={};
  ALL_POS.forEach(p=>{ hands[p]=[null,null]; stacks[p]=100; contributed[p]=0; });
  // Pre-post blinds: SB=1bb, BB=2bb, pot=3bb by default
  stacks['SB']=99; contributed['SB']=1;
  stacks['BB']=98; contributed['BB']=2;
  const blindRound=[
    {pos:'SB',action:'blind',amount:1},
    {pos:'BB',action:'blind',amount:2},
  ];
  return {
    hands, folded:new Set(), street:0, community:[],
    streetRounds:{ preflop:[blindRound], flop:[[]], turn:[[]], river:[[]] },
    equities:{}, stacks, pot:3, contributed,
    betDropOpen:null, notes:'', blindsPosted:true, straddle:false,
  };
}

function rnd(n){ return Math.round(n*10)/10; }
function derivedActive(hands){ return POST_ORD.filter(p=>hands[p][0]||hands[p][1]); }

function runMC(hands,community,iters=500){
  const deck=[];
  for(const s of['h','d','c','s']) for(const r of RANKS) deck.push(r+s);
  const known=new Set();
  hands.forEach(h=>h.forEach(c=>{if(c&&c.suit!=='u')known.add(c.rank+c.suit)}));
  community.forEach(c=>{if(c&&c.suit!=='u')known.add(c.rank+c.suit)});
  const avail=deck.filter(c=>!known.has(c));
  const wins=new Array(hands.length).fill(0);
  const rv=r=>RANKS.indexOf(r);
  function best(cards){
    const cnt={},sg={};
    cards.forEach(c=>{const r=c[0],s=c.slice(1);cnt[r]=(cnt[r]||0)+1;if(!sg[s])sg[s]=[];sg[s].push(r)});
    const vals=cards.map(c=>rv(c[0])).sort((a,b)=>a-b);
    const grp=Object.values(cnt).sort((a,b)=>b-a);
    const fl=Object.values(sg).some(g=>g.length>=5);
    let st=false;
    for(let i=0;i<=vals.length-5;i++){if(vals[i+4]-vals[i]===4&&new Set(vals.slice(i,i+5)).size===5){st=true;break}}
    if(fl&&st)return 8;if(grp[0]===4)return 7;if(grp[0]===3&&grp[1]>=2)return 6;
    if(fl)return 5;if(st)return 4;if(grp[0]===3)return 3;
    if(grp[0]===2&&grp[1]===2)return 2;if(grp[0]===2)return 1;return 0;
  }
  for(let i=0;i<iters;i++){
    const sh=[...avail].sort(()=>Math.random()-0.5);let idx=0;
    const filled=hands.map(h=>h.map(c=>(c&&c.suit!=='u')?c.rank+c.suit:sh[idx++]));
    const board=[...community.filter(c=>c&&c.suit!=='u').map(c=>c.rank+c.suit)];
    while(board.length<5)board.push(sh[idx++]);
    const sc=filled.map(h=>best([...h,...board]));
    const bst=Math.max(...sc);
    sc.reduce((a,v,i)=>{if(v===bst)a.push(i);return a;},[]).forEach(w=>wins[w]+=1/sc.filter(v=>v===bst).length);
  }
  const tot=wins.reduce((a,b)=>a+b,0)||1;
  return wins.map(w=>Math.round((w/tot)*100));
}

function pendingInRound(rounds,ri,active,folded,isPreflop,customPreflopOrder){
  const base=(isPreflop?(customPreflopOrder||PRE_ORD):POST_ORD).filter(p=>active.includes(p)&&!folded.has(p));
  // For ri===0 preflop: blinds/straddle count as "pre-acted" but real actions (fold/call/raise/check) count as fully acted
  const realActed=new Set((rounds[ri]||[]).filter(a=>!['blind','straddle'].includes(a.action)).map(a=>a.pos));
  const blindActed=new Set((rounds[ri]||[]).filter(a=>['blind','straddle'].includes(a.action)).map(a=>a.pos));
  if(ri===0) return base.filter(p=>!realActed.has(p));
  const agg=[...(rounds[ri-1]||[])].reverse().find(a=>a.action==='bet')?.pos;
  return base.filter(p=>p!==agg&&!realActed.has(p));
}

function buildRecord(S,active){
  const players=POST_ORD.filter(p=>active.includes(p)).map(p=>{
    const h=S.hands[p],c1=h[0],c2=h[1];
    const s1=SUITS.find(x=>x.id===c1?.suit),s2=SUITS.find(x=>x.id===c2?.suit);
    return{pos:p,card1:c1?`${c1.suit==='u'?'?':c1.rank}${s1?.sym||'?'}`:null,card2:c2?`${c2.suit==='u'?'?':c2.rank}${s2?.sym||'?'}`:null,stack:S.stacks[p],folded:S.folded.has(p)};
  });
  const board=S.community.map(c=>{const s=SUITS.find(x=>x.id===c.suit);return`${c.suit==='u'?'?':c.rank}${s?.sym||'?'}`});
  const actionLog={};
  STREETS.forEach(st=>{
    const rounds=S.streetRounds[st];
    if(rounds.flat().filter(a=>a.action!=='blind').length>0)
      actionLog[st]=rounds.map(r=>r.filter(a=>a.action!=='blind').map(a=>{let d=`${a.pos}: ${a.action}`;if(a.amount)d+=` ${a.amount}bb`;return d;}));
  });
  return{id:Date.now(),date:new Date().toLocaleString(),players,board,pot:S.pot,notes:S.notes||'',actionLog};
}

// ── Card display chip ─────────────────────────────────────────
function CardChip({card, size=44}){
  if(!card) return(
    <div style={{width:size,height:size*1.4,borderRadius:6,border:'2px dashed #39ff14',background:'#831843',display:'flex',alignItems:'center',justifyContent:'center',color:'#39ff14',fontSize:size*0.4,flexShrink:0}}>?</div>
  );
  const si=SUITS.find(x=>x.id===card.suit);
  if(card.suit==='u') return(
    <div style={{width:size,height:size*1.4,borderRadius:6,background:'#e65100',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:1,flexShrink:0}}>
      <span style={{fontSize:size*0.38,fontWeight:700,color:'#fff',lineHeight:1}}>?</span>
      <span style={{fontSize:size*0.26,color:'#fff'}}>?</span>
    </div>
  );
  return(
    <div style={{width:size,height:size*1.4,borderRadius:6,background:si?.bg||'#333',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:1,flexShrink:0}}>
      <span style={{fontSize:size*0.38,fontWeight:800,color:'#fff',lineHeight:1}}>{card.rank}</span>
      <span style={{fontSize:size*0.28,color:'#fff',lineHeight:1}}>{si?.sym}</span>
    </div>
  );
}

function HistoryCardChip({text}){
  const si=SUITS.find(s=>s.sym===text?.slice(-1));
  return <span style={{display:'inline-flex',alignItems:'center',justifyContent:'center',minWidth:34,padding:'3px 6px',borderRadius:5,background:si?.bg||'#1a1030',color:'#fff',fontSize:13,fontWeight:700,margin:'0 2px'}}>{text||'?'}</span>;
}

// ── Full card table picker modal ──────────────────────────────
function CardTablePicker({pos, hands, onSelect, onClose}){
  const used=new Set();
  Object.values(hands).forEach(h=>h.forEach(c=>{if(c&&c.suit!=='u')used.add(c.rank+c.suit)}));
  const current = hands[pos] || [null,null];
  // slot 0 first, then slot 1, then close
  const slot = !current[0] ? 0 : !current[1] ? 1 : 0;

  function handleCard(rank, suit){
    const key=rank+suit;
    if(used.has(key)) return;
    onSelect(pos, slot, {rank, suit});
    // if this was slot 0 and slot 1 is empty, stay open for slot 1
    // if this was slot 1 (or both filled), close
    if(slot===1 || current[0]) onClose();
  }
  function handleUnknown(){
    onSelect(pos, slot, {rank:'', suit:'u'});
    if(slot===1 || current[0]) onClose();
  }
  // When closing, auto-fill any empty slots with unknown
  function handleClose(){
    if(!current[0]) onSelect(pos, 0, {rank:'', suit:'u'});
    if(!current[1]) onSelect(pos, 1, {rank:'', suit:'u'});
    onClose();
  }
  function clearCard(s){ onSelect(pos, s, null); }

  const SUIT_ROWS = [
    {suit:'h', sym:'♥', bg:'#c62828'},
    {suit:'d', sym:'♦', bg:'#1565c0'},
    {suit:'c', sym:'♣', bg:'#1a6b2a'},
    {suit:'s', sym:'♠', bg:'#222222'},
  ];

  return(
    <div onClick={handleClose} style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:1000,background:'#0a0010',display:'flex',flexDirection:'column',padding:'8px 4px',boxSizing:'border-box'}}>
      <div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',flex:1,height:'100%',padding:'0 4px'}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6,padding:'0 4px'}}>
          <div style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:2}}>{pos}</div>
          <button onClick={handleClose} style={{background:'none',border:'none',color:'#a78bfa',fontSize:26,cursor:'pointer',lineHeight:1,padding:'0 4px'}}>✕</button>
        </div>

        {/* Card 1 and Card 2 preview */}
        <div style={{display:'flex',gap:8,justifyContent:'center',marginBottom:6}}>
          {[0,1].map(s=>{
            const c=current[s];
            const si=SUIT_ROWS.find(x=>x.suit===c?.suit);
            const isActive = (!current[0]&&s===0)||(current[0]&&!current[1]&&s===1);
            return(
              <div key={s} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                <div style={{
                  width:52,height:72,borderRadius:8,
                  border:`3px solid ${isActive?'#39ff14':'#3b0764'}`,
                  background:c?(si?.bg||'#e65100'):'#1a1030',
                  display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,
                  boxShadow:isActive?'0 0 12px rgba(57,255,20,0.6)':'none',
                }}>
                  {c?<>
                    <span style={{fontSize:20,fontWeight:800,color:'#fff',lineHeight:1}}>{c.suit==='u'?'?':c.rank}</span>
                    <span style={{fontSize:14,color:'#fff'}}>{si?.sym||'?'}</span>
                  </>:<span style={{fontSize:11,color:'#4c1d95',fontWeight:600}}>C{s+1}</span>}
                </div>
                {c&&<button onClick={()=>clearCard(s)} style={{fontSize:9,color:'#ef4444',background:'none',border:'none',cursor:'pointer',padding:0}}>clear</button>}
              </div>
            );
          })}
        </div>

        {/* Prompt */}
        <div style={{textAlign:'center',fontSize:11,color:'#a3e635',marginBottom:4,fontWeight:600,letterSpacing:1}}>
          {!current[0]?'SELECT CARD 1':!current[1]?'SELECT CARD 2':'TAP TO CHANGE'}
        </div>

        {/* Card table: scrollable */}
        <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',justifyContent:'space-evenly'}}>
        {SUIT_ROWS.map(({suit,sym,bg})=>{
          const CardBtn=({rank})=>{
            const key=rank+suit;
            const isUsed=used.has(key);
            const isC1=current[0]?.rank===rank&&current[0]?.suit===suit;
            const isC2=current[1]?.rank===rank&&current[1]?.suit===suit;
            return(
              <button onClick={()=>!isUsed&&handleCard(rank,suit)} style={{
                width:0,flexGrow:1,height:52,borderRadius:10,
                background:isC1?'#39ff14':isC2?'#22d3ee':isUsed?'#1a0a2e':bg,
                border:'none',
                cursor:isUsed&&!isC1&&!isC2?'not-allowed':'pointer',
                opacity:isUsed&&!isC1&&!isC2?0.2:1,
                fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent',padding:0,
                display:'flex',alignItems:'center',justifyContent:'center',
                fontSize:22,fontWeight:900,
                color:isC1||isC2?'#000':'#fff',
              }}>{rank}</button>
            );
          };
          return(
            <div key={suit} style={{marginBottom:6}}>
              <div style={{display:'flex',gap:3,alignItems:'center'}}>
                <div style={{width:30,textAlign:'center',fontSize:24,color:bg,flexShrink:0,fontWeight:700}}>{sym}</div>
                {RANKS.map(rank=><CardBtn key={rank} rank={rank}/>)}
              </div>
            </div>
          );
        })}

        </div>

      </div>
    </div>
  );
}

// Community card table picker
function CommTablePicker({idx, hands, community, onSelect, onClose, openStreet=0, onNextCommCard}){
  const used=new Set();
  Object.values(hands).forEach(h=>h.forEach(c=>{if(c&&c.suit!=='u')used.add(c.rank+c.suit)}));
  community.forEach((c,i)=>{if(c&&c.suit!=='u'&&i!==idx)used.add(c.rank+c.suit)});

  const current = community[idx] || null;
  const suitColors=['#c62828','#1565c0','#1a6b2a','#222222'];
  const suitSyms=['♥','♦','♣','♠'];
  const suitIds=['h','d','c','s'];

  return(
    <div onClick={onClose} style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:1000,background:'rgba(5,0,20,0.97)',display:'flex',flexDirection:'column',alignItems:'stretch',justifyContent:'flex-start',padding:0}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#0f0a1a',border:'2px solid #22d3ee',borderRadius:16,padding:14,width:'100%',maxWidth:420,boxShadow:'0 0 40px rgba(34,211,238,0.3)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <div style={{fontSize:15,fontWeight:800,color:'#fff',letterSpacing:2}}>{openStreet===1?'SELECT FLOP CARDS':openStreet===2?'SELECT TURN CARD':openStreet===3?'SELECT RIVER CARD':`Board Card ${idx+1}`}</div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#67e8f9',fontSize:22,cursor:'pointer',padding:'0 4px',lineHeight:1}}>✕</button>
        </div>
        <div style={{display:'flex',justifyContent:'center',marginBottom:12}}>
          <CardChip card={current} size={52}/>
        </div>
        <div style={{textAlign:'center',fontSize:11,color:'#22d3ee',marginBottom:10,fontWeight:600,letterSpacing:1}}>TAP TO SELECT BOARD CARD</div>
        {/* Unknown — single button */}
        <button onClick={()=>onSelect(idx,{rank:'',suit:'u'})} style={{width:'100%',padding:'13px',borderRadius:8,border:'2px solid #f97316',background:'#7c2d12',color:'#fb923c',fontSize:16,fontWeight:800,cursor:'pointer',fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent',marginBottom:6,letterSpacing:1}}>
          ? Unknown Card
        </button>
        {suitIds.map((suit,si)=>(
          <div key={suit} style={{display:'flex',gap:3,marginBottom:4,alignItems:'center'}}>
            <div style={{width:28,textAlign:'center',fontSize:24,color:suitColors[si],flexShrink:0,alignSelf:'center'}}>{suitSyms[si]}</div>
            {RANKS.map(rank=>{
              const key=rank+suit;const isUsed=used.has(key);
              const isCurrent=current&&current.rank===rank&&current.suit===suit;
              return(
                <button key={rank} onClick={()=>!isUsed&&onSelect(idx,{rank,suit})} style={{width:0,flexGrow:1,aspectRatio:'2/3',borderRadius:6,background:isCurrent?'#39ff14':isUsed?'#1a1030':suitColors[si],color:isCurrent?'#000':isUsed?'#3b0764':'#fff',fontSize:15,fontWeight:800,border:`1px solid rgba(255,255,255,${isUsed?0.05:0.15})`,cursor:isUsed?'not-allowed':'pointer',opacity:isUsed&&!isCurrent?0.25:1,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent',padding:0,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  {rank}
                </button>
              );
            })}
          </div>
        ))}
        <div style={{textAlign:'center',marginTop:10}}>
          <button onClick={onClose} style={{padding:'10px 32px',borderRadius:8,border:'none',background:'linear-gradient(135deg,#0e7490,#22d3ee)',color:'#000',fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>Done</button>
        </div>
      </div>
    </div>
  );
}

// ── History screens ───────────────────────────────────────────
function HandDetail({hand,onBack,onDelete}){
  const C={bg:'#1a0a2e',card2:'#120d1e',gold:'#a3e635',border:'#6b21a8',dim:'#1a1030'};
  const lbl={fontSize:11,color:'#a3e635',textTransform:'uppercase',letterSpacing:2,marginBottom:8,fontWeight:700};
  return(
    <div style={{background:'#1a0a2e',minHeight:'100vh',padding:16,color:'#e9d5ff',fontFamily:'sans-serif',maxWidth:560,margin:'0 auto',paddingBottom:40}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <button onClick={onBack} style={{padding:'8px 14px',borderRadius:6,border:'1px solid #6b21a8',background:'#1a1030',color:'#c8b4f8',cursor:'pointer',fontSize:13,minHeight:44,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>← Back</button>
        <div style={{flex:1}}><div style={{fontSize:12,color:'#a3e635',fontWeight:500}}>Hand Review</div><div style={{fontSize:11,color:'#6b21a8'}}>{hand.date}</div></div>
        <button onClick={()=>onDelete(hand.id)} style={{padding:'8px 12px',borderRadius:6,border:'1px solid #7b1f1f',background:'#4a1010',color:'#ffcdd2',cursor:'pointer',fontSize:12,minHeight:44,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>Delete</button>
      </div>
      <div style={{background:'#120d1e',borderRadius:8,padding:'10px 14px',marginBottom:12,border:'1px solid #6b21a8'}}>
        <div style={{fontSize:10,color:'#22d3ee',textTransform:'uppercase',letterSpacing:1}}>Final Pot</div>
        <div style={{fontSize:22,fontWeight:700,color:'#a3e635'}}>{rnd(hand.pot)} bb</div>
      </div>
      <div style={lbl}>Players & hole cards</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8,marginBottom:14}}>
        {hand.players.map(p=>(
          <div key={p.pos} style={{background:'#120d1e',borderRadius:8,padding:'8px 10px',display:'flex',alignItems:'center',gap:8,opacity:p.folded?0.5:1,border:'1px solid #3b0764'}}>
            <div style={{minWidth:36,textAlign:'center',fontSize:13,color:'#fff',fontWeight:700}}>{p.pos}</div>
            <div style={{display:'flex',gap:4}}>{p.card1&&<HistoryCardChip text={p.card1}/>}{p.card2&&<HistoryCardChip text={p.card2}/>}</div>
            <div style={{fontSize:10,color:'#a3e635',marginLeft:'auto'}}>{rnd(p.stack)}bb</div>
          </div>
        ))}
      </div>
      {hand.board?.length>0&&(<><div style={lbl}>Board</div><div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:14}}>{hand.board.map((c,i)=><HistoryCardChip key={i} text={c}/>)}</div></>)}
      {Object.keys(hand.actionLog||{}).length>0&&(<>
        <div style={lbl}>Action log</div>
        {STREETS.filter(st=>hand.actionLog[st]).map(st=>(
          <div key={st} style={{background:'#120d1e',borderRadius:8,padding:10,marginBottom:8,border:'1px solid #3b0764'}}>
            <div style={{fontSize:11,color:'#22d3ee',fontWeight:600,marginBottom:6,textTransform:'capitalize'}}>{st}</div>
            {hand.actionLog[st].map((round,ri)=>(<div key={ri} style={{marginBottom:4}}>{ri>0&&<div style={{fontSize:10,color:'#22d3ee',marginBottom:2}}>↩ Response round</div>}{round.map((line,li)=><div key={li} style={{fontSize:12,color:'#c8b4f8',padding:'2px 0',borderBottom:'1px solid #1a0a2e'}}>{line}</div>)}</div>))}
          </div>
        ))}
      </>)}
      <div style={lbl}>Notes</div>
      <div style={{background:'#120d1e',borderRadius:8,padding:10,fontSize:13,color:'#c8b4f8',minHeight:40,whiteSpace:'pre-wrap',border:'1px solid #3b0764'}}>{hand.notes||<span style={{color:'#4c1d95',fontStyle:'italic'}}>No notes</span>}</div>
    </div>
  );
}

function HistoryScreen({history,onSelect,onBack,onClearAll}){
  const [confirming,setConfirming]=useState(false);
  return(
    <div style={{background:'#1a0a2e',minHeight:'100vh',padding:16,color:'#e9d5ff',fontFamily:'sans-serif',maxWidth:560,margin:'0 auto',paddingBottom:40}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
        <button onClick={onBack} style={{padding:'8px 14px',borderRadius:6,border:'1px solid #6b21a8',background:'#1a1030',color:'#c8b4f8',cursor:'pointer',fontSize:13,minHeight:44,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>← Back</button>
        <div style={{flex:1,fontSize:16,fontWeight:500,color:'#a3e635'}}>Hand History ({history.length})</div>
        {history.length>0&&!confirming&&<button onClick={()=>setConfirming(true)} style={{padding:'6px 12px',borderRadius:6,border:'1px solid #7b1f1f',background:'#4a1010',color:'#ffcdd2',cursor:'pointer',fontSize:11,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>Clear all</button>}
        {confirming&&<div style={{display:'flex',gap:6,alignItems:'center'}}>
          <span style={{fontSize:11,color:'#ffcdd2'}}>Sure?</span>
          <button onClick={()=>{onClearAll();setConfirming(false);}} style={{padding:'6px 10px',borderRadius:6,border:'1px solid #ef5350',background:'#7b1f1f',color:'#ffcdd2',cursor:'pointer',fontSize:11,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>Yes</button>
          <button onClick={()=>setConfirming(false)} style={{padding:'6px 10px',borderRadius:6,border:'1px solid #6b21a8',background:'#1a1030',color:'#c8b4f8',cursor:'pointer',fontSize:11,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>Cancel</button>
        </div>}
      </div>
      {history.length===0&&<div style={{textAlign:'center',color:'#4c1d95',marginTop:60,fontSize:14}}>No saved hands yet.</div>}
      {history.map(h=>(
        <div key={h.id} onClick={()=>onSelect(h)} style={{background:'#120d1e',borderRadius:12,padding:12,marginBottom:8,cursor:'pointer',border:'1px solid #3b0764'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <div style={{fontSize:11,color:'#6b21a8'}}>{h.date}</div>
            <div style={{fontSize:12,color:'#a3e635',fontWeight:600}}>Pot: {rnd(h.pot)}bb</div>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:4}}>
            {h.players.filter(p=>p.card1||p.card2).map(p=>(
              <span key={p.pos} style={{fontSize:12,color:p.folded?'#4c1d95':'#c8b4f8'}}>
                <span style={{color:'#fff',fontWeight:700}}>{p.pos}</span> {p.card1||'?'}{p.card2||'?'}
              </span>
            ))}
          </div>
          {h.board?.length>0&&<div style={{display:'flex',gap:3,flexWrap:'wrap'}}>{h.board.map((c,i)=><HistoryCardChip key={i} text={c}/>)}</div>}
          {h.notes&&<div style={{marginTop:5,fontSize:11,color:'#a3e635',fontStyle:'italic'}}>"{h.notes.slice(0,60)}{h.notes.length>60?'…':''}"</div>}
        </div>
      ))}
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────
export default function PokerLogger(){
  const [S,setS]=useState(mkState);
  const [straddle,setStraddle]=useState(false);
  const [stackDropOpen,setStackDropOpen]=useState(null);
  const [cardPicker,setCardPicker]=useState(null); // {type:'hole',pos} or {type:'comm',idx}
  const [history,setHistory]=useState(loadHistory);
  const [screen,setScreen]=useState('logger');
  const [selectedHand,setSelectedHand]=useState(null);

  useEffect(()=>{ saveHistory(history); },[history]);

  const upd=useCallback(fn=>setS(prev=>{
    const n={...prev,
      hands:Object.fromEntries(Object.entries(prev.hands).map(([k,v])=>[k,[...v]])),
      stacks:{...prev.stacks},contributed:{...prev.contributed},
      streetRounds:{preflop:prev.streetRounds.preflop.map(r=>[...r]),flop:prev.streetRounds.flop.map(r=>[...r]),turn:prev.streetRounds.turn.map(r=>[...r]),river:prev.streetRounds.river.map(r=>[...r])},
      folded:new Set(prev.folded),equities:{...prev.equities},community:[...prev.community],
    };
    fn(n);return n;
  }),[]);

  function maybePostBlinds(n, isStraddle){
    if(n.blindsPosted)return;
    const sbHasCard=n.hands['SB'][0]||n.hands['SB'][1];
    const bbHasCard=n.hands['BB'][0]||n.hands['BB'][1];
    if(!sbHasCard||!bbHasCard)return;
    // If straddle, UTG must also have cards
    const useStraddle = isStraddle !== undefined ? isStraddle : straddle;
    if(useStraddle&&derivedActive(n.hands).includes('UTG')&&!(n.hands['UTG'][0]||n.hands['UTG'][1]))return;
    n.blindsPosted=true;
    const sb=Math.min(1,n.stacks['SB']||0);
    n.stacks['SB']=Math.max(0,(n.stacks['SB']||0)-sb);n.contributed['SB']=sb;n.pot+=sb;
    n.streetRounds.preflop[0].push({pos:'SB',action:'blind',amount:sb});
    const bb=Math.min(2,n.stacks['BB']||0);
    n.stacks['BB']=Math.max(0,(n.stacks['BB']||0)-bb);n.contributed['BB']=bb;n.pot+=bb;
    n.streetRounds.preflop[0].push({pos:'BB',action:'blind',amount:bb});
    // UTG straddle = 4bb, acts last preflop
    if(useStraddle&&derivedActive(n.hands).includes('UTG')){
      const str=Math.min(4,n.stacks['UTG']||0);
      n.stacks['UTG']=Math.max(0,(n.stacks['UTG']||0)-str);n.contributed['UTG']=str;n.pot+=str;
      n.streetRounds.preflop[0].push({pos:'UTG',action:'straddle',amount:str});
    }
  }

  function calcEq(n,active){
    const kn=active.filter(p=>!n.folded.has(p)&&n.hands[p][0]&&n.hands[p][1]);
    if(kn.length<2){n.equities={};return;}
    setTimeout(()=>{
      const eq=runMC(kn.map(p=>n.hands[p]),n.community);
      setS(prev=>({...prev,equities:Object.fromEntries(kn.map((p,i)=>[p,eq[i]]))}));
    },10);
  }

  // Select a hole card for a position
  function selectHoleCard(pos, slot, card){
    upd(n=>{
      n.hands[pos][slot]=card;
      calcEq(n,derivedActive(n.hands));
    });
  }

  // Select a community card
  function selectCommCard(idx, card){
    upd(n=>{
      const c=[...n.community];
      c[idx]=card;
      n.community=c;
      calcEq(n,derivedActive(n.hands));
    });
    setCardPicker(null);
  }

  function updateStack(pos,val){const v=parseFloat(val);if(!isNaN(v)&&v>=0)upd(n=>{n.stacks[pos]=v;});}
  function updateNotes(val){upd(n=>{n.notes=val;});}

  function setAct(pos,act,ri){
    if(act==='bet'){upd(n=>{n.betDropOpen=n.betDropOpen===`${pos}_${ri}`?null:`${pos}_${ri}`;});return;}
    upd(n=>{
      const active=derivedActive(n.hands);
      const sn=STREETS[n.street];const rounds=n.streetRounds[sn];
      while(rounds.length<=ri)rounds.push([]);
      const round=rounds[ri];const ei=round.findIndex(a=>a.pos===pos);if(ei>=0)round.splice(ei,1);
      if(act==='fold'){n.folded.add(pos);round.push({pos,action:'fold'});}
      else if(act==='call'){
        const allBets=rounds.flat().filter(a=>a.amount>0).map(a=>a.amount);
        const maxBet=allBets.length?Math.max(...allBets):(n.street===0?2:0);
        const prev=n.contributed[pos]||0;const ca=Math.min(Math.max(0,maxBet-prev),n.stacks[pos]||0);
        n.pot+=ca;n.contributed[pos]=prev+ca;n.stacks[pos]=Math.max(0,(n.stacks[pos]||0)-ca);
        round.push({pos,action:'call',amount:ca});
      } else if(act==='allin'){
        const stk=n.stacks[pos]||0,prev=n.contributed[pos]||0;
        n.pot+=stk;n.contributed[pos]=prev+stk;n.stacks[pos]=0;n.folded.add(pos);round.push({pos,action:'allin',amount:stk});
      } else round.push({pos,action:'check'});
      n.betDropOpen=null;
    });
  }

  function selectBet(pos,val,ri){
    upd(n=>{
      const active=derivedActive(n.hands);
      const sn=STREETS[n.street];const rounds=n.streetRounds[sn];
      while(rounds.length<=ri)rounds.push([]);
      const round=rounds[ri];const ei=round.findIndex(a=>a.pos===pos);if(ei>=0)round.splice(ei,1);
      const isAllin=val==='allin',stk=n.stacks[pos]||0;
      const amount=isAllin?stk:Math.min(parseFloat(val),stk);
      const prev=n.contributed[pos]||0,adding=Math.max(0,amount-prev);
      n.pot+=adding;n.contributed[pos]=amount;n.stacks[pos]=Math.max(0,stk-adding);
      round.push({pos,action:'bet',amount,allin:isAllin});
      if(isAllin)n.folded.add(pos);
      const ip=n.street===0;
      const others=(ip?PRE_ORD:POST_ORD).filter(p=>active.includes(p)&&!n.folded.has(p)&&p!==pos);
      if(others.length>0&&rounds.length<=ri+1)rounds.push([]);
      n.betDropOpen=null;
    });
  }

  function nextStreet(){
    upd(n=>{if(n.street>=3)return;n.street++;n.contributed={};ALL_POS.forEach(p=>n.contributed[p]=0);n.betDropOpen=null;});
    // Open community card picker for the new street
    // flop=street1 needs cards 0,1,2 → open multi-card picker starting at idx 0
    // turn=street2 needs card 3 → idx 3, river=street3 needs card 4 → idx 4
    setTimeout(()=>{
      setCardPicker({type:'comm', idx: S.street===0?0:S.street===1?3:4, openStreet:S.street+1});
    },50);
  }

  function saveAndNew(){
    const active=derivedActive(S.hands);
    setHistory(prev=>[buildRecord(S,active),...prev]);
    const ps={...S.stacks};
    setS(()=>{const f=mkState();ALL_POS.forEach(p=>{if(ps[p]!==undefined)f.stacks[p]=ps[p];});return f;});
    setCardPicker(null);
  }
  function resetHand(){
    const ps={...S.stacks};
    setS(()=>{const f=mkState();ALL_POS.forEach(p=>{if(ps[p]!==undefined)f.stacks[p]=ps[p];});return f;});
    setCardPicker(null);
  }
  function deleteHand(id){setHistory(prev=>prev.filter(h=>h.id!==id));setScreen('history');setSelectedHand(null);}
  function clearAll(){setHistory([]);}

  function preflopOpts(minRaise=2){
    // Min raise preflop = last raise size, minimum 2bb (or double the last bet)
    const o=[];
    for(let i=Math.ceil(minRaise/2)*2;i<=100;i+=2)o.push({label:`${i}bb`,val:i});
    o.push({label:'ALL IN',val:'allin'});
    return o;
  }
  function postflopOpts(pot,minRaise=1){
    if(!pot||pot<=0)return preflopOpts(minRaise);
    const min=Math.max(1,minRaise);
    const opts=[
      {label:`Min (${rnd(min)}bb)`,val:rnd(min)},
      {label:`¼ pot (${rnd(pot*.25)}bb)`,val:rnd(pot*.25)},
      {label:`⅓ pot (${rnd(pot*.33)}bb)`,val:rnd(pot*.33)},
      {label:`½ pot (${rnd(pot*.5)}bb)`,val:rnd(pot*.5)},
      {label:`⅔ pot (${rnd(pot*.67)}bb)`,val:rnd(pot*.67)},
      {label:`Pot (${rnd(pot)}bb)`,val:rnd(pot)},
      {label:`1.5x (${rnd(pot*1.5)}bb)`,val:rnd(pot*1.5)},
      {label:`2x (${rnd(pot*2)}bb)`,val:rnd(pot*2)},
      {label:`3x (${rnd(pot*3)}bb)`,val:rnd(pot*3)},
      {label:'ALL IN',val:'allin'},
    ];
    // Filter out sizes below minimum raise
    return opts.filter(o=>o.val==='allin'||o.val>=min);
  }

  if(screen==='history')return <HistoryScreen history={history} onSelect={h=>{setSelectedHand(h);setScreen('detail');}} onBack={()=>setScreen('logger')} onClearAll={clearAll}/>;
  if(screen==='detail'&&selectedHand)return <HandDetail hand={selectedHand} onBack={()=>setScreen('history')} onDelete={deleteHand}/>;

  const active=derivedActive(S.hands);
  const sn=STREETS[S.street];
  const isPreflop=S.street===0;
  // When straddle is on, UTG acts last preflop (after BB, like a third blind)
  const preflopOrder = S.straddle&&active.includes('UTG')
    ? ['MP','LJ','HJ','CO','BTN','SB','BB','UTG']
    : PRE_ORD;
  const comN=sn==='flop'?3:sn==='turn'?4:sn==='river'?5:0;
  const rounds=S.streetRounds[sn];

  const roundsToShow=[];
  for(let ri=0;ri<rounds.length;ri++){
    const pending=pendingInRound(rounds,ri,active,S.folded,isPreflop,preflopOrder);
    const hasActs=(rounds[ri]||[]).filter(a=>a.action!=='blind').length>0;
    if(ri===0){if(hasActs||pending.length>0)roundsToShow.push({ri,pending});}
    else{const pb=(rounds[ri-1]||[]).find(a=>a.action==='bet');if(pb&&(pending.length>0||hasActs))roundsToShow.push({ri,pending});}
  }
  if(roundsToShow.length===0)roundsToShow.push({ri:0,pending:pendingInRound(rounds,0,active,S.folded,isPreflop,preflopOrder)});

  // Action complete check
  const allActed=active.filter(p=>!S.folded.has(p)).every(p=>rounds.flat().some(a=>a.pos===p&&a.action!=='blind'));
  const noPending=roundsToShow.every(({pending})=>pending.length===0);
  const actionDone=active.length>=2&&allActed&&noPending;
  const streetLabel=S.street===0?'Deal Flop →':S.street===1?'Deal Turn →':S.street===2?'Deal River →':'Hand Complete ✓';

  const C={bg:'#1a0a2e',card2:'#120d1e',green:'#65a30d',border:'#6b21a8',dim:'#1a1030'};
  const lbl={fontSize:11,color:'#a3e635',textTransform:'uppercase',letterSpacing:2,marginBottom:8,fontWeight:700};
  const inp={background:'#0a0814',border:'1px solid #6b21a8',color:'#ff10f0',borderRadius:6,padding:'4px 6px',width:58,fontSize:12,fontWeight:700,textAlign:'center',fontFamily:'sans-serif'};
  function abtn(on,fold=false,betOpen=false){
    // off: white bg, purple border, green text
    // fold on: red tint
    // bet open: cyan tint
    // other on: green glow
    return{
      padding:'8px 10px',borderRadius:8,
      border:`2px solid ${betOpen?'#22d3ee':fold&&on?'#ef5350':on?'#39ff14':'#39ff14'}`,
      background:betOpen?'#0e7490':fold&&on?'#7b1f1f':on?'#000':'#ffffff',
      color:betOpen?'#fff':fold&&on?'#ffcdd2':on?'#39ff14':'#a855f7',
      cursor:'pointer',fontSize:13,minHeight:44,fontFamily:'sans-serif',fontWeight:700,
      WebkitTapHighlightColor:'transparent',
      boxShadow:on?`0 0 10px ${fold?'rgba(239,83,80,0.5)':betOpen?'rgba(34,211,238,0.5)':'rgba(57,255,20,0.4)'}`:
'0 0 6px rgba(168,85,247,0.3)',
    };
  }

  return(
    <div style={{background:'linear-gradient(160deg,#1a0a2e 0%,#2d1b69 50%,#1a0a2e 100%)',minHeight:'100vh',padding:16,color:'#e9d5ff',fontFamily:'sans-serif',maxWidth:560,margin:'0 auto',paddingBottom:40}}>

      {/* Card picker modals */}
      {cardPicker?.type==='hole'&&(
        <CardTablePicker
          pos={cardPicker.pos}
          hands={S.hands}
          onSelect={(pos,slot,card)=>{ selectHoleCard(pos,slot,card); }}
          onClose={()=>setCardPicker(null)}
        />
      )}
      {cardPicker?.type==='comm'&&(
        <CommTablePicker
          idx={cardPicker.idx}
          openStreet={cardPicker.openStreet||0}
          hands={S.hands}
          community={S.community}
          onSelect={(idx,card)=>{
            selectCommCard(idx,card);
            // For flop, auto-advance to next card slot
            const street=cardPicker.openStreet||0;
            if(street===1&&idx<2){
              setTimeout(()=>setCardPicker({type:'comm',idx:idx+1,openStreet:1}),100);
            } else {
              setCardPicker(null);
            }
          }}
          onClose={()=>setCardPicker(null)}
        />
      )}

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
        <div style={{fontSize:22,fontWeight:900,color:'#ffffff',letterSpacing:3,textTransform:'uppercase',textShadow:'0 0 20px rgba(255,255,255,0.4)'}}>RUN IT BACK</div>
        <button onClick={()=>setScreen('history')} style={{padding:'7px 12px',borderRadius:8,border:'1px solid #a855f7',background:'#1a1030',color:'#f0abfc',cursor:'pointer',fontSize:12,minHeight:38,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent',fontWeight:600}}>📋 {history.length}</button>
      </div>

      {/* Pot */}
      <div style={{background:'linear-gradient(135deg,#120d1e,#0d0b18)',border:'1px solid #7c3aed',borderRadius:12,padding:'12px 16px',marginBottom:14,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8,boxShadow:'0 0 20px rgba(124,58,237,0.3)'}}>
        <div>
          <div style={{fontSize:10,color:'#22d3ee',textTransform:'uppercase',letterSpacing:2,marginBottom:2,fontWeight:600}}>Pot</div>
          <div style={{fontSize:28,fontWeight:800,color:'#ff10f0',textShadow:'0 0 14px rgba(255,16,240,0.7)'}}>{rnd(S.pot)} bb</div>
        </div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'center'}}>
          {active.filter(p=>!S.folded.has(p)).map(p=>(
            <div key={p} style={{textAlign:'center'}}>
              <div style={{fontSize:9,color:'#6b21a8',textTransform:'uppercase'}}>{p}</div>
              <div style={{fontSize:12,color:'#ff10f0',fontWeight:600}}>{rnd(S.stacks[p]||0)}bb</div>
            </div>
          ))}
        </div>
      </div>

      {/* Straddle toggle — show before cards are picked */}
      {active.includes('UTG')&&S.street===0&&(
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,padding:'10px 14px',background:'#120d1e',borderRadius:8,border:`1px solid ${straddle?'#39ff14':'#3b0764'}`}}>
          <span style={{fontSize:13,color:'#e9d5ff',fontWeight:600,flex:1}}>UTG Straddle <span style={{color:'#6b21a8',fontSize:11}}>(4bb — acts last)</span></span>
          <div onClick={()=>{const ns=!straddle;setStraddle(ns);upd(n=>{n.straddle=ns;// Reset blinds with or without straddle
            n.pot=0;n.contributed={};ALL_POS.forEach(p=>n.contributed[p]=0);n.streetRounds.preflop=[[]];
            n.stacks['SB']=99;n.contributed['SB']=1;n.pot+=1;n.streetRounds.preflop[0].push({pos:'SB',action:'blind',amount:1});
            n.stacks['BB']=98;n.contributed['BB']=2;n.pot+=2;n.streetRounds.preflop[0].push({pos:'BB',action:'blind',amount:2});
            if(ns){n.stacks['UTG']=96;n.contributed['UTG']=4;n.pot+=4;n.streetRounds.preflop[0].push({pos:'UTG',action:'straddle',amount:4});}
            n.blindsPosted=true;});}} style={{width:48,height:26,borderRadius:13,background:straddle?'#39ff14':'#3b0764',cursor:'pointer',display:'flex',alignItems:'center',padding:'0 3px',transition:'background 0.2s',WebkitTapHighlightColor:'transparent',flexShrink:0}}>
            <div style={{width:20,height:20,borderRadius:10,background:'#fff',transform:straddle?'translateX(22px)':'translateX(0)',transition:'transform 0.2s'}}/>
          </div>
        </div>
      )}
      {/* Hole cards — single card per position showing pos name, tap to pick */}
      <div style={lbl}>Hole cards <span style={{color:'#6b21a8',fontSize:10,textTransform:'none',letterSpacing:0,fontWeight:400}}>— tap to select</span></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:8,marginBottom:14}}>
        {POST_ORD.map(pos=>{
          const folded=S.folded.has(pos);
          const isActive=active.includes(pos);
          const eq=S.equities[pos];
          const c1=S.hands[pos]?.[0], c2=S.hands[pos]?.[1];
          const SUIT_BG=['#c62828','#1565c0','#1a6b2a','#222222'];
          const SUIT_SYM=['♥','♦','♣','♠'];
          const SUIT_IDS=['h','d','c','s'];
          // card face bg based on c1 suit
          const c1si=SUIT_IDS.indexOf(c1?.suit);
          const cardBg=c1&&c1.suit!=='u'?SUIT_BG[c1si]||'#e65100':c1&&c1.suit==='u'?'#e65100':'#1a1030';
          // card 2 suit bg
          const c2si=SUIT_IDS.indexOf(c2?.suit);
          const c2Bg=c2&&c2.suit!=='u'?SUIT_BG[c2si]||'#e65100':c2&&c2.suit==='u'?'#e65100':'#2a1a3a';

          return(
            <div key={pos} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:5,opacity:folded?0.4:1}}>
              {/* Card peek container */}
              <div
                onClick={()=>setCardPicker({type:'hole',pos})}
                style={{width:'100%',position:'relative',cursor:'pointer',height:160,WebkitTapHighlightColor:'transparent'}}
              >
                {/* ── No cards yet: show two unknown cards ── */}
                {!isActive&&(
                  <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:3,padding:4}}>
                    <div style={{fontSize:8,color:'rgba(255,255,255,0.35)',fontWeight:700,letterSpacing:1}}>{pos}</div>
                    <div style={{display:'flex',gap:4,justifyContent:'center'}}>
                      {[0,1].map(i=>(
                        <div key={i} style={{width:44,height:62,borderRadius:6,background:'#1a1030',border:'2px solid #ffffff',display:'flex',flexDirection:'column',justifyContent:'space-between',padding:'3px 4px',flexShrink:0}}>
                          <div style={{fontSize:15,fontWeight:900,color:'#3b0764',lineHeight:1}}>?</div>
                          <div style={{textAlign:'center',fontSize:16,color:'rgba(59,7,100,0.4)'}}>?</div>
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end'}}>
                            <span style={{fontSize:9,fontWeight:900,color:'rgba(57,255,20,0.3)',letterSpacing:1}}>{pos}</span>
                            <span style={{fontSize:13,fontWeight:900,color:'#3b0764'}}>?</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Only card 1 selected ── */}
                {isActive&&c1&&!c2&&(
                  <div style={{
                    position:'absolute',inset:0,borderRadius:10,
                    border:'2px solid #a3e635',background:cardBg,
                    display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:2,
                    boxShadow:`0 0 12px ${cardBg}99`,
                  }}>
                    <span style={{fontSize:9,color:'rgba(255,255,255,0.6)',letterSpacing:1,fontWeight:600}}>{pos}</span>
                    <span style={{fontSize:22,fontWeight:900,color:'#fff',lineHeight:1}}>{c1.suit==='u'?'?':c1.rank}</span>
                    <span style={{fontSize:14,color:'#fff'}}>{c1.suit==='u'?'?':SUIT_SYM[SUIT_IDS.indexOf(c1.suit)]}</span>
                  </div>
                )}

                {/* ── Both cards: two cards side by side ── */}
                {isActive&&c1&&c2&&(
                  <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:4}}>
                    {[{card:c1,bg:cardBg},{card:c2,bg:c2Bg}].map(({card,bg},idx)=>{
                      const sym=card.suit==='u'?'?':SUIT_SYM[SUIT_IDS.indexOf(card.suit)];
                      const rnk=card.suit==='u'?'?':card.rank;
                      return(
                        <div key={idx} style={{width:88,height:124,borderRadius:10,background:'#000',border:'2px solid #ffffff',boxShadow:`0 0 10px ${bg}88`,display:'flex',flexDirection:'column',justifyContent:'space-between',padding:'3px 4px',flexShrink:0,position:'relative',overflow:'hidden'}}>
                          {/* Top-left rank */}
                          <div style={{fontSize:26,fontWeight:900,color:bg,lineHeight:1}}>{rnk}</div>
                          {/* Big center suit in suit color */}
                          <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none'}}>
                            <span style={{fontSize:56,color:bg,lineHeight:1,filter:`drop-shadow(0 0 8px ${bg})`}}>{sym}</span>
                          </div>
                          {/* Bottom row: pos left, rank right */}
                          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',zIndex:1}}>
                            <span style={{fontSize:11,fontWeight:900,color:'#39ff14',letterSpacing:1,lineHeight:1}}>{pos}</span>
                            <span style={{fontSize:22,fontWeight:900,color:bg,lineHeight:1}}>{rnk}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Stack dropdown */}
              <div style={{position:'relative',width:'100%'}}>
                <button
                  onClick={()=>setStackDropOpen(stackDropOpen===pos?null:pos)}
                  style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #6b21a8',background:'#0a0814',color:'#ff10f0',fontSize:12,fontWeight:700,textAlign:'center',fontFamily:'sans-serif',cursor:'pointer',WebkitTapHighlightColor:'transparent'}}
                >
                  {rnd(S.stacks[pos]||0)}bb ▾
                </button>
                {stackDropOpen===pos&&(
                  <div style={{position:'absolute',top:'100%',left:0,right:0,zIndex:200,background:'#120d1e',border:'1px solid #6b21a8',borderRadius:8,overflow:'hidden',marginTop:2,boxShadow:'0 4px 16px rgba(0,0,0,0.8)'}}>
                    {[100,125,150,175,200,250,300,350,400,500].map(bb=>(
                      <div key={bb} onClick={()=>{updateStack(pos,bb);setStackDropOpen(null);}}
                        style={{padding:'8px 12px',color:S.stacks[pos]===bb?'#39ff14':'#e9d5ff',background:S.stacks[pos]===bb?'rgba(57,255,20,0.1)':'transparent',fontSize:13,fontWeight:600,cursor:'pointer',borderBottom:'1px solid #1a0a2e',WebkitTapHighlightColor:'transparent'}}
                        onTouchStart={e=>e.currentTarget.style.background='#1a1030'} onTouchEnd={e=>e.currentTarget.style.background=S.stacks[pos]===bb?'rgba(57,255,20,0.1)':'transparent'}
                        onMouseEnter={e=>e.currentTarget.style.background='#1a1030'} onMouseLeave={e=>e.currentTarget.style.background=S.stacks[pos]===bb?'rgba(57,255,20,0.1)':'transparent'}
                      >
                        {bb}bb
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {typeof eq==='number'&&isActive&&(
                <div style={{width:'100%'}}>
                  <div style={{background:'#0a0814',borderRadius:6,height:14,overflow:'hidden'}}><div style={{width:`${eq}%`,height:'100%',background:'linear-gradient(90deg,#a3e635,#22d3ee)',borderRadius:6,transition:'width 0.4s'}}/></div>
                  <div style={{fontSize:32,color:'#a3e635',fontWeight:900,textAlign:'center',marginTop:4,lineHeight:1,textShadow:'0 0 10px rgba(163,230,53,0.7)'}}>{eq}%</div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Community cards */}
      {S.street>0&&(
        <>
          <div style={lbl}>Community cards</div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}}>
            {Array.from({length:comN}).map((_,i)=>(
              <div key={i} onClick={()=>setCardPicker({type:'comm',idx:i})} style={{cursor:'pointer'}}>
                <CardChip card={S.community[i]} size={50}/>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Action rounds */}
      {active.length>=2&&roundsToShow.map(({ri,pending})=>{
        const roundActs=rounds[ri]||[];
        const agg=ri>0?[...(rounds[ri-1]||[])].reverse().find(a=>a.action==='bet'):null;
        // Min raise = size of last bet/raise (or 2bb preflop by default)
        const lastBet=rounds.flat().filter(a=>a.action==='bet'&&a.amount>0).map(a=>a.amount);
        const lastBetAmt=lastBet.length?Math.max(...lastBet):0;
        const preflopMin=isPreflop?(S.straddle?4:2):0;
        // Min raise-to = last bet amount + (last bet - previous bet), simplified: 2x last bet or +lastBet
        const minRaiseAmt=lastBetAmt>0?lastBetAmt*2:preflopMin*2||2;
        const betOpts=isPreflop?preflopOpts(minRaiseAmt):postflopOpts(S.pot,lastBetAmt>0?lastBetAmt:1);
        const actedSet=new Set(roundActs.map(a=>a.pos));
        // Show ALL active non-folded players in acting order
        const allOrderedPos=(isPreflop?preflopOrder:POST_ORD).filter(p=>active.includes(p)&&!S.folded.has(p));
        // Only the FIRST pending player can act — others wait
        const firstPending=pending[0]||null;
        const posToShow=allOrderedPos;
        return(
          <div key={ri} style={{background:'#120d1e',borderRadius:10,padding:12,marginBottom:10,border:ri>0?'1px solid #22d3ee':'1px solid #3b0764',boxShadow:ri>0?'0 0 12px rgba(34,211,238,0.15)':'none'}}>
            <div style={{display:'flex',alignItems:'baseline',gap:6,marginBottom:6,flexWrap:'wrap'}}>
              <div style={{...lbl,marginBottom:0}}>{sn.charAt(0).toUpperCase()+sn.slice(1)} action</div>
              {ri>0&&<span style={{fontSize:11,color:'#22d3ee',fontWeight:500}}>↩ Responding to {agg?.pos}'s bet ({agg?.amount}bb){ri>1?` — round ${ri+1}`:''}</span>}
            </div>
            {posToShow.map((pos,i)=>{
              const ae=roundActs.find(a=>a.pos===pos&&!['blind','straddle'].includes(a.action)),act=ae?.action;
              const isPending=pending.includes(pos),isFolded=S.folded.has(pos);
              const dk=`${pos}_${ri}`,isBetOpen=S.betDropOpen===dk;

              // Calculate price to call
              // Preflop: blinds set the floor (2bb, or 4bb with straddle)
              // Any raises on top add to that
              const preflopFloor = isPreflop ? (S.straddle ? 4 : 2) : 0;
              // Get all raise/bet amounts this street (exclude blinds)
              const allStreetActs = rounds.flat().filter(a=>!['blind','straddle'].includes(a.action));
              const raiseAmounts = allStreetActs.filter(a=>a.action==='bet'&&a.amount>0).map(a=>a.amount);
              const maxRaise = raiseAmounts.length ? Math.max(...raiseAmounts) : 0;
              const maxBet = Math.max(preflopFloor, maxRaise);
              // How much has THIS player put in: blinds/straddle + real actions (no double count)
              const blindsIn = isPreflop ? (S.streetRounds.preflop[0].filter(a=>a.pos===pos&&['blind','straddle'].includes(a.action)).reduce((s,a)=>s+a.amount,0)) : 0;
              const actsIn = allStreetActs.filter(a=>a.pos===pos&&a.amount>0).reduce((s,a)=>s+a.amount,0);
              const myIn = blindsIn + actsIn;
              const facingBet = maxBet > myIn;

              // BB gets to check (live option) if pot wasn't raised beyond 2bb
              const isBBOption = isPreflop && pos==='BB' && !S.straddle && maxBet<=2 && myIn>=2;
              // UTG straddle gets live option if pot wasn't raised beyond 4bb
              const isStraddleOption = isPreflop && pos==='UTG' && S.straddle && maxBet<=4 && myIn>=4;
              const hasLiveOption = isBBOption || isStraddleOption;

              // Valid actions
              const canFold = facingBet && !hasLiveOption;
              const canCheck = hasLiveOption || (!isPreflop && !facingBet);
              const canCall = facingBet && !hasLiveOption;
              const canRaise = true;
              const canAllin = true;

              return(
                <div key={pos} style={{marginTop:10,opacity:isFolded?0.35:1}}>
                  <div style={{fontSize:11,color:isPending?'#a3e635':'#6b21a8',marginBottom:4,display:'flex',alignItems:'center',gap:6}}>
                    <span style={{color:'#fff',fontWeight:700}}>{pos}</span>
                    <span style={{color:'#ff10f0',fontSize:10}}>({rnd(S.stacks[pos]||0)}bb)</span>
                    {act&&<span style={{fontSize:10,color:act==='fold'?'#ef5350':act==='bet'?'#22d3ee':'#a3e635'}}>{act==='bet'?`raised ${ae.amount}bb`:act==='call'?`called ${ae.amount}bb`:act==='allin'?`all-in ${ae.amount}bb`:act}</span>}
                  </div>
                  {/* Only show buttons for the current player to act */}
                  {!isFolded&&(pos===firstPending||(isPending&&!firstPending))&&(
                    <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                      {canFold&&<button onClick={()=>setAct(pos,'fold',ri)} style={abtn(act==='fold',true)}>Fold</button>}
                      {canCheck&&<button onClick={()=>setAct(pos,'check',ri)} style={abtn(act==='check')}>Check</button>}
                      {canCall&&<button onClick={()=>setAct(pos,'call',ri)} style={abtn(act==='call')}>Call {rnd(Math.min(maxBet-myIn,S.stacks[pos]||0))}bb</button>}
                      {canRaise&&<button onClick={()=>setAct(pos,'bet',ri)} style={abtn(act==='bet'||isBetOpen,false,isBetOpen)}>{facingBet?'Raise':'Bet'}{ae?.amount&&act==='bet'?` (${ae.amount}bb)`:''} ▾</button>}
                      {canAllin&&<button onClick={()=>setAct(pos,'allin',ri)} style={abtn(act==='allin')}>All-in</button>}
                    </div>
                  )}
                  {/* Already acted — show summary only */}
                  {!isFolded&&act&&act!=='blind'&&act!=='straddle'&&pos!==firstPending&&(
                    <div style={{fontSize:11,color:'#4c1d95',fontStyle:'italic'}}>
                      {act==='bet'?`raised ${ae.amount}bb`:act==='call'?`called ${ae.amount}bb`:act==='allin'?`all-in ${ae.amount}bb`:act}
                    </div>
                  )}
                  {/* Waiting to act */}
                  {!isFolded&&!act&&pos!==firstPending&&(
                    <div style={{fontSize:11,color:'#3b0764'}}>waiting...</div>
                  )}
                  {isBetOpen&&(
                    <div style={{background:'#0a0814',border:'1px solid #6b21a8',borderRadius:10,padding:8,marginTop:6,display:'flex',flexWrap:'wrap',gap:5}}>
                      {betOpts.map(o=>(<button key={o.val} onClick={()=>selectBet(pos,o.val,ri)} style={{padding:'6px 10px',borderRadius:6,background:o.val==='allin'?'rgba(127,29,29,0.9)':'rgba(26,16,48,0.9)',border:`1px solid ${o.val==='allin'?'#ef5350':'#6b21a8'}`,color:o.val==='allin'?'#fca5a5':'#e9d5ff',cursor:'pointer',fontSize:11,fontWeight:600,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent'}}>{o.label}</button>))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Deal button — only when action complete */}
      {actionDone&&S.street<3&&(
        <div style={{display:'flex',justifyContent:'center',marginBottom:14}}>
          <button onClick={nextStreet} style={{padding:'13px 0',borderRadius:10,border:'none',background:'linear-gradient(135deg,#65a30d,#22d3ee)',color:'#000',cursor:'pointer',fontSize:15,fontWeight:800,minHeight:50,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent',boxShadow:'0 0 24px rgba(101,163,13,0.7)',letterSpacing:1,width:'100%',maxWidth:340}}>
            {S.street===0?'Select Flop Cards':S.street===1?'Select Turn Card':'Select River Card'}
          </button>
        </div>
      )}

      {/* Notes */}
      <div style={lbl}>Notes (optional)</div>
      <textarea value={S.notes||''} onChange={e=>updateNotes(e.target.value)} placeholder="Add a note..." rows={2} style={{width:'100%',background:'#0a0814',border:'1px solid #6b21a8',color:'#e9d5ff',borderRadius:10,padding:10,fontSize:13,fontFamily:'sans-serif',resize:'vertical',marginBottom:14,boxSizing:'border-box'}}/>

      {/* Bottom nav */}
      <div style={{display:'flex',gap:8,justifyContent:'center'}}>
        <button onClick={saveAndNew} style={{padding:'8px 18px',borderRadius:7,border:'1px solid #a855f7',background:'#000000',color:'#39ff14',cursor:'pointer',fontSize:13,fontWeight:800,minHeight:44,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent',boxShadow:'none'}}>💾 Save</button>
        <button onClick={resetHand} style={{padding:'8px 14px',borderRadius:10,border:'1px solid #a855f7',background:'#000000',color:'#39ff14',cursor:'pointer',fontSize:13,minHeight:44,fontFamily:'sans-serif',WebkitTapHighlightColor:'transparent',fontWeight:600}}>↺ Reset</button>
      </div>
    </div>
  );
}
