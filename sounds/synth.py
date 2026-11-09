import numpy as np, wave
SR=44100; rng=np.random.default_rng(7)
def lp(x,fc):  # one-pole lowpass
    a=np.exp(-2*np.pi*fc/SR); y=np.empty_like(x); s=0.0
    for i,v in enumerate(x): s=(1-a)*v+a*s; y[i]=s
    return y
def damped(freqs,decay,n,amps):
    t=np.arange(n)/SR
    return sum(a*np.sin(2*np.pi*f*t+rng.uniform(0,6.28))*np.exp(-t/decay) for f,a in zip(freqs,amps))
def save(name,x):
    x=x/np.max(np.abs(x))*0.7
    w=wave.open(name,'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((x*32767).astype('<i2').tobytes()); w.close()
# ---- clockwork ~2.5 s ----
D=2.5; N=int(SR*D); t=np.arange(N)/SR; out=np.zeros(N)
# click rate: ramps up then down (matches ease of hand sweep)
env_rate=8+18*np.sin(np.pi*np.clip(t/D,0,1))**0.8
ph=np.cumsum(env_rate)/SR; idx=np.where(np.diff(np.floor(ph))>0)[0]
clickN=int(0.03*SR)
for k,i in enumerate(idx):
    b=rng.normal(size=clickN)*np.exp(-np.arange(clickN)/(0.0025*SR))
    b=b-lp(b,1500)                      # crisp, but highpassed
    r=damped([2300*rng.uniform(.97,1.03),3700,5200],0.008,clickN,[.5,.3,.15])
    c=(0.55*b+r)*(0.75 if k%2 else 1.0)  # tick/tock alternation
    e=min(N,i+clickN); out[i:e]+=c[:e-i]
# soft gear whirr: lowpassed noise modulated by click rate
wh=lp(lp(rng.normal(size=N),900),900); wh=wh/np.max(np.abs(wh))
wh*=0.18*(0.6+0.4*np.sin(2*np.pi*ph))
whine=0.04*np.sin(2*np.pi*np.cumsum(180+120*np.sin(np.pi*t/D))/SR)
out+=wh+whine
fade=np.minimum(1,np.minimum(t/0.08,(D-t)/0.25))
out*=fade*np.sin(np.pi*np.clip(t/D,0,1))**0.3
# final 'clunk' as the hand settles
cl=int(0.12*SR); s0=N-cl-int(0.05*SR)
out[s0:s0+cl]+=0.9*damped([420,1180,2650],0.025,cl,[.6,.3,.2])
save('clockwork.wav',out)
# ---- chime ~1.5 s ----
D=1.5; N=int(SR*D); t=np.arange(N)/SR
f0=1046.5  # C6
parts=[(1,1,1.1),(2.0,.35,.6),(2.76,.25,.45),(5.4,.08,.25),(8.93,.04,.15)]
x=sum(a*np.sin(2*np.pi*f0*r*t)*np.exp(-t/d) for r,a,d in parts)
x+=0.5*sum(a*np.sin(2*np.pi*f0*1.4983*r*t)*np.exp(-np.maximum(t-0.12,0)/d)*(t>0.12) for r,a,d in parts[:3])  # soft fifth (G6)
att=np.minimum(1,t/0.004); x*=att*np.minimum(1,(D-t)/0.3)
save('chime.wav',x)
