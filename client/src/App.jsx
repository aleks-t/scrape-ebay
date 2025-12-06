import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis
} from 'recharts';
import { Search, Loader2, TrendingUp, DollarSign, Package, Calendar, ExternalLink, Filter, X, Camera, Eye, Trash2, Settings as SettingsIcon, Clock, ArrowLeft, Plus } from 'lucide-react';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

export default function App() {
  const [activeTab, setActiveTab] = useState('search');
  
  // Search State
  const [term, setTerm] = useState('');
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [identifying, setIdentifying] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  
  // Watchlist State
  const [watchlist, setWatchlist] = useState([]);
  const [watchLoading, setWatchLoading] = useState(false);
  const [watchTerm, setWatchTerm] = useState(''); // For adding directly
  const [viewingWatchItem, setViewingWatchItem] = useState(null); // If viewing a watchlist dashboard

  // Settings State
  const [retentionDays, setRetentionDays] = useState(30);
  const [workerStatus, setWorkerStatus] = useState(null);
  
  // New State for N-grams
  const [ngramSize, setNgramSize] = useState(2);
  const [listingFilter, setListingFilter] = useState('');
  
  const fileInputRef = useRef(null);

  // Check Pi connection status every 10 seconds
  useEffect(() => {
    const checkWorkerStatus = async () => {
      try {
        const res = await axios.get('/api/health');
        setWorkerStatus(res.data);
      } catch (e) {
        setWorkerStatus({ server: 'online', worker: 'disconnected' });
      }
    };
    checkWorkerStatus();
    const interval = setInterval(checkWorkerStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  // Poll for job status
  useEffect(() => {
    let interval;
    // Check for saved job on mount
    const savedJobId = localStorage.getItem('activeJobId');
    if (savedJobId && !jobId && !data) {
       setJobId(savedJobId);
       setLoading(true);
    }

    if (jobId) {
      let failureCount = 0;
      interval = setInterval(async () => {
        try {
          const res = await axios.get(`/api/jobs/${jobId}`);
          failureCount = 0; // Reset on success
          
          if (res.data.progress) setProgress(res.data.progress);
          if (res.data.result) setData(res.data.result);

          if (res.data.status === 'completed') { 
            setData(res.data.result);
            setLoading(false);
            setJobId(null);
            setProgress(null);
            localStorage.removeItem('activeJobId');
            fetchHistory();
          } else if (res.data.status === 'failed') {
            setError(res.data.errorMessage || 'Search failed');
            setLoading(false);
            setJobId(null);
            setProgress(null);
            localStorage.removeItem('activeJobId');
          }
        } catch (e) {
          failureCount++;
          // If job not found or too many failures, clear it
          if (e.response?.status === 404 || failureCount > 3) {
            console.log('Job not found or failed to load, clearing...');
            setError('Job not found. It may have expired.');
            setLoading(false);
            setJobId(null);
            setProgress(null);
            localStorage.removeItem('activeJobId');
          }
        }
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [jobId, loading]);

  useEffect(() => {
    fetchHistory();
    fetchWatchlist();
    fetchSettings();
  }, []);

  const fetchHistory = async () => { try { const res = await axios.get('/api/history'); setHistory(res.data); } catch (e) {} };
  
  const fetchWatchlist = async () => {
    try { 
      setWatchLoading(true);
      const res = await axios.get('/api/watchlist'); 
      setWatchlist(res.data); 
    } catch (e) {
    } finally { setWatchLoading(false); }
  };

  const fetchSettings = async () => {
    try {
        const res = await axios.get('/api/settings');
        if (res.data.retentionDays) setRetentionDays(res.data.retentionDays);
    } catch (e) {}
  };

  const saveSettings = async () => {
      try {
          await axios.post('/api/settings', { key: 'retentionDays', value: retentionDays });
          // Tell Pi to cleanup based on new retention policy
          try {
            await axios.post('/api/worker/cleanup', { retentionDays });
          } catch(e) {
            console.log('Pi cleanup request sent (will apply on next poll)');
          }
          alert('Settings Saved! Pi will clean up old data.');
      } catch (e) { alert('Failed to save'); }
  };

  const handleSearch = async (e) => {
    e?.preventDefault();
    if (!term) return;
    const isUrl = term.match(/^(http|https):\/\//i);
    if (isUrl) { await handleLinkIdentify(term); return; }
    
    setLoading(true); setError(null); setData(null); setListingFilter(''); setViewingWatchItem(null);
    try {
      const res = await axios.post('/api/search', { searchTerm: term, days });
      setJobId(res.data.jobId);
      localStorage.setItem('activeJobId', res.data.jobId); // Persist job ID
    } catch (err) {
      setError('Failed to start search. Please try again.');
      setLoading(false);
    }
  };

  const addToWatchlist = async (searchTerm) => {
      try {
          await axios.post('/api/watchlist', { searchTerm });
          setWatchTerm('');
          fetchWatchlist();
          alert(`Added "${searchTerm}" to Watchlist. Initial scrape started.`);
          if (activeTab !== 'watchlist') setActiveTab('watchlist');
      } catch (e) {
          alert(e.response?.data?.error || 'Failed to add');
      }
  };

  const deleteWatch = async (e, id) => {
      e.stopPropagation(); // Prevent card click
      if (!confirm('Stop tracking this item? Data will be deleted.')) return;
      try {
          await axios.delete(`/api/watchlist/${id}`);
          fetchWatchlist();
          if (viewingWatchItem === id) { setViewingWatchItem(null); setData(null); }
      } catch (e) { alert('Failed to delete'); }
  };

  const loadWatchlistAnalysis = async (item) => {
      setViewingWatchItem(item.id);
      setLoading(true); setData(null); setListingFilter('');
      try {
          const res = await axios.get(`/api/watchlist/${item.id}/analysis`);
          setData(res.data);
      } catch (e) {
          setError('Failed to load analysis data.');
      } finally {
          setLoading(false);
      }
  };

  const backToWatchlist = () => {
      setViewingWatchItem(null);
      setData(null);
  };

  const handleLinkIdentify = async (url) => {
    setIdentifying(true); setError(null);
    try {
      const res = await axios.post('/api/identify', { imageUrl: url });
      if (res.data.searchTerm) setTerm(res.data.searchTerm);
      else setError('Could not identify item from link.');
    } catch (err) { setError('Failed to identify link.'); } 
    finally { setIdentifying(false); }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIdentifying(true); setError(null);
    const formData = new FormData();
    formData.append('image', file);
    try {
      const res = await axios.post('/api/identify', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      if (res.data.searchTerm) setTerm(res.data.searchTerm);
      else setError('Could not identify item from image.');
    } catch (err) { setError(`Identify failed: ${err.response?.data?.error || err.message}`); } 
    finally { setIdentifying(false); if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const loadHistoryItem = async (id) => {
    setLoading(true); setData(null); setListingFilter(''); setViewingWatchItem(null);
    localStorage.removeItem('activeJobId'); // Clear any active background job tracking
    try {
      const res = await axios.get(`/api/jobs/${id}`);
      if (res.data.status === 'completed') {
        setData(res.data.result);
        setTerm(res.data.searchTerm.replace(/\s\(\d+ days\)/, '')); 
      } else {
        setJobId(id);
      }
    } catch (e) { setError('Could not load history item'); } 
    finally { if (!jobId) setLoading(false); }
  };

  const getCurrentNgrams = () => {
    if (!data || !data.trends) return [];
    switch(ngramSize) {
      case 3: return data.trends.ngrams3 || [];
      case 4: return data.trends.ngrams4 || [];
      case 5: return data.trends.ngrams5 || [];
      case 6: return data.trends.ngrams6 || [];
      default: return data.trends.ngrams || [];
    }
  };

  const cancelSearch = () => {
    setLoading(false);
    setJobId(null);
    setProgress(null);
    localStorage.removeItem('activeJobId');
    setData(null);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 pb-8 font-sans selection:bg-blue-500/30">
      {/* Sticky Progress Bar */}
      {loading && progress && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-blue-500/30 shadow-lg transition-transform duration-300">
          <div className="h-1 w-full bg-slate-800">
             <div className="h-full bg-blue-500 transition-all duration-500 ease-out" style={{ width: `${Math.min(100, (progress.page / (data ? 200 : 60)) * 100)}%` }}></div>
          </div>
          <div className="max-w-7xl mx-auto px-4 py-2 flex justify-between items-center text-xs md:text-sm font-medium">
            <div className="flex items-center gap-2 text-blue-300">
               <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
               <span>Scraping Live...</span>
               <span className="hidden md:inline text-slate-400">|</span>
               <span className="text-slate-200">{(progress.itemsFound || 0).toLocaleString()} items found</span>
            </div>
            <div className="flex items-center gap-4 text-slate-400">
               <span>Page {progress.page || 1}</span>
               <button onClick={cancelSearch} className="text-red-400 hover:text-red-300 underline text-xs">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className={`max-w-7xl mx-auto space-y-6 p-4 md:p-8 ${loading && progress ? 'mt-12' : ''}`}>
        
        {/* Header & Tabs */}
        <header className="flex flex-col md:flex-row justify-between items-end gap-4 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 text-transparent bg-clip-text mb-2">
              eBay Market Pulse
            </h1>
            
            {/* Pi Connection Status */}
            {workerStatus && (
              <div className="flex items-center gap-2 text-xs mb-2">
                <div className={`w-2 h-2 rounded-full ${workerStatus.worker === 'connected' ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                <span className={workerStatus.worker === 'connected' ? 'text-emerald-400' : 'text-red-400'}>
                  Raspberry Pi: {workerStatus.worker === 'connected' ? 'Connected' : 'Disconnected'}
                </span>
                {workerStatus.jobsInQueue > 0 && (
                  <span className="text-slate-500">• {workerStatus.jobsInQueue} jobs queued</span>
                )}
              </div>
            )}
            
            <div className="flex gap-1">
                <button 
                    onClick={() => { setActiveTab('search'); setViewingWatchItem(null); setData(null); }}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeTab === 'search' ? 'bg-slate-800 text-blue-400 border-t border-x border-slate-700' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <Search className="inline w-4 h-4 mr-2" /> Live Search
                </button>
                <button 
                    onClick={() => { setActiveTab('watchlist'); setData(null); }}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeTab === 'watchlist' ? 'bg-slate-800 text-emerald-400 border-t border-x border-slate-700' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <Eye className="inline w-4 h-4 mr-2" /> Watchlist
                </button>
                <button 
                    onClick={() => { setActiveTab('settings'); setViewingWatchItem(null); setData(null); }}
                    className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${activeTab === 'settings' ? 'bg-slate-800 text-slate-300 border-t border-x border-slate-700' : 'text-slate-400 hover:text-slate-200'}`}
                >
                    <SettingsIcon className="inline w-4 h-4 mr-2" /> Settings
                </button>
            </div>
          </div>
          
          {activeTab === 'search' && history.length > 0 && (
             <select onChange={(e) => loadHistoryItem(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value="">
               <option value="" disabled>Load History...</option>
               {history.map(h => <option key={h.id} value={h.id}>{h.searchTerm} - {new Date(h.createdAt).toLocaleDateString()}</option>)}
             </select>
          )}
        </header>

        {/* --- TAB 1: SEARCH --- */}
        {activeTab === 'search' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 shadow-xl">
                  <form onSubmit={handleSearch} className="flex flex-col md:flex-row gap-4 items-end">
                    <div className="flex-1 w-full">
                      <label className="block text-sm font-medium text-slate-400 mb-1">Product Name or Image Link</label>
                      <div className="relative flex gap-2">
                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-3 h-5 w-5 text-slate-500" />
                          <input
                            type="text"
                            value={term}
                            onChange={(e) => setTerm(e.target.value)}
                            placeholder="e.g. iPhone 13 Pro Max OR paste image URL"
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                          />
                        </div>
                        <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={identifying || loading} className="px-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors flex items-center justify-center group relative" title="Upload Image">
                          {identifying ? <Loader2 className="h-5 w-5 animate-spin text-blue-400" /> : <Camera className="h-5 w-5 text-slate-400 group-hover:text-slate-200" />}
                        </button>
                      </div>
                    </div>
                    <div className="w-full md:w-48">
                      <label className="block text-sm font-medium text-slate-400 mb-1">Lookback: {days} Days</label>
                      <input type="range" min="1" max="60" value={days} onChange={(e) => setDays(parseInt(e.target.value))} className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                    </div>
                    <button type="submit" disabled={loading || identifying} className="w-full md:w-auto px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed rounded-lg font-medium transition-colors flex items-center justify-center gap-2 min-w-[120px]">
                      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Analyze'}
                    </button>
                  </form>
                </div>
                {/* (Shared Dashboard View Below) */}
            </div>
        )}

        {/* --- TAB 2: WATCHLIST --- */}
        {activeTab === 'watchlist' && !viewingWatchItem && (
             <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                
                {/* Quick Add Bar */}
                <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 flex gap-4 items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                        <input 
                            type="text" 
                            value={watchTerm}
                            onChange={(e) => setWatchTerm(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && addToWatchlist(watchTerm)}
                            placeholder="Add item to watchlist..." 
                            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                    </div>
                    <button 
                        onClick={() => addToWatchlist(watchTerm)}
                        disabled={!watchTerm}
                        className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Plus className="h-4 w-4" /> Add
                    </button>
                </div>

                <div className="grid grid-cols-1 gap-4">
                    {watchlist.length === 0 && !watchLoading && (
                        <div className="text-center py-20 bg-slate-900 rounded-xl border border-slate-800">
                            <Eye className="h-12 w-12 text-slate-700 mx-auto mb-4" />
                            <h3 className="text-lg font-medium text-slate-300">Your Watchlist is Empty</h3>
                            <p className="text-slate-500 mt-2">Use the bar above to track an item.</p>
                        </div>
                    )}

                    {watchlist.map(item => (
                        <div 
                            key={item.id} 
                            onClick={() => loadWatchlistAnalysis(item)}
                            className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-blue-500/50 cursor-pointer transition-all flex flex-col md:flex-row justify-between items-center gap-6 group relative overflow-hidden"
                        >
                            {/* Hover Glow */}
                            <div className="absolute inset-0 bg-blue-500/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"></div>

                            <div className="flex-1 relative z-10">
                                <div className="flex items-center gap-3 mb-1">
                                    <h3 className="text-xl font-semibold text-slate-200 group-hover:text-blue-300 transition-colors">{item.searchTerm}</h3>
                                    {item.isActive ? (
                                        <span className="bg-emerald-500/10 text-emerald-400 text-xs px-2 py-0.5 rounded-full border border-emerald-500/20">Active</span>
                                    ) : (
                                        <span className="bg-slate-700 text-slate-400 text-xs px-2 py-0.5 rounded-full">Paused</span>
                                    )}
                                </div>
                                <div className="flex gap-6 text-sm text-slate-400 mt-2">
                                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Last Run: {item.lastRun ? new Date(item.lastRun).toLocaleString() : 'Pending'}</span>
                                    <span className="flex items-center gap-1"><Package className="h-3 w-3" /> Total Found: {item.totalItemsFound}</span>
                                </div>
                            </div>
                            
                            {item.newItemsSinceLastView > 0 && (
                                <div className="bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg flex flex-col items-center min-w-[80px] animate-pulse">
                                    <span className="text-xl font-bold leading-none">{item.newItemsSinceLastView}</span>
                                    <span className="text-[10px] uppercase tracking-wider opacity-80">New Items</span>
                                </div>
                            )}

                            <div className="flex gap-2 relative z-10">
                                <button className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition-colors" onClick={(e) => deleteWatch(e, item.id)}>
                                    <Trash2 className="h-5 w-5" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
             </div>
        )}

        {/* --- TAB 3: SETTINGS --- */}
        {activeTab === 'settings' && (
             <div className="max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
                 <div className="bg-slate-900 p-8 rounded-xl border border-slate-800">
                     <h2 className="text-xl font-semibold mb-6 flex items-center gap-2"><SettingsIcon className="h-5 w-5 text-slate-400" /> System Settings</h2>
                     <div className="mb-8">
                         <label className="block text-sm font-medium text-slate-300 mb-2">Data Retention Policy</label>
                         <p className="text-xs text-slate-500 mb-4">Automatically delete watchlist items older than this to save database space.</p>
                         <div className="flex items-center gap-4">
                             <input type="range" min="7" max="90" step="1" value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} className="flex-1 h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500" />
                             <span className="bg-slate-950 border border-slate-800 px-3 py-1 rounded text-blue-400 font-mono min-w-[4rem] text-center">{retentionDays} Days</span>
                         </div>
                     </div>
                     <div className="pt-6 border-t border-slate-800 flex justify-end">
                         <button onClick={saveSettings} className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors">Save Changes</button>
                     </div>
                 </div>
             </div>
        )}

        {/* --- SHARED DASHBOARD (For Search OR Watchlist Detail) --- */}
        {(data || loading) && (activeTab === 'search' || viewingWatchItem) && (
           <div className="space-y-6 animate-in fade-in duration-500">
             
             {/* Watchlist Header (Back Button) */}
             {viewingWatchItem && (
                 <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                     <button onClick={backToWatchlist} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
                         <ArrowLeft className="h-5 w-5" /> Back to Watchlist
                     </button>
                     <h2 className="text-xl font-bold text-emerald-400">{data?.meta?.searchTerm} Analysis</h2>
                 </div>
             )}

             {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-lg">{error}</div>}

             {loading && !data && (
               <div className="text-center py-20">
                 <Loader2 className="h-12 w-12 animate-spin mx-auto text-blue-500 mb-4" />
                 <p className="text-slate-400 text-lg mb-2">
                    {viewingWatchItem ? 'Loading analysis from database...' : 'Scraping eBay... this may take a minute.'}
                 </p>
                 <button onClick={cancelSearch} className="text-sm text-red-400 hover:text-red-300 underline mt-2">Cancel Search</button>
                 {progress && (
                    <div className="max-w-md mx-auto mt-4 p-4 bg-slate-900 rounded-lg border border-slate-800">
                      <div className="flex justify-between text-sm text-slate-400 mb-2"><span>Page {progress.page || 1}</span><span>{progress.itemsFound || 0} Items Found</span></div>
                      <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-blue-500 h-2.5 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (progress.page / 60) * 100)}%` }}></div>
                      </div>
                      <p className="text-xs text-slate-500 mt-2">Current Date Reached: {progress.lastItemDate || 'Unknown'}</p>
                    </div>
                 )}
               </div>
             )}

             {data && (
               <>
                 {/* Live Progress Indicator */}
                 {loading && progress && (
                   <div className="bg-blue-900/20 border border-blue-500/20 p-3 rounded-lg flex items-center justify-between animate-pulse">
                     <div className="flex items-center gap-3"><Loader2 className="h-4 w-4 animate-spin text-blue-400" /><span className="text-sm text-blue-300">Live Updating... Found {progress.itemsFound} items (Page {progress.page})</span></div>
                     <span className="text-xs text-blue-400 font-mono">{progress.lastItemDate}</span>
                   </div>
                 )}

                 {/* Watch Button (Only if in Live Search) */}
                 {!viewingWatchItem && (
                     <div className="flex justify-end">
                         <button onClick={() => addToWatchlist(data.meta.searchTerm)} className="flex items-center gap-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg transition-colors shadow-lg shadow-emerald-900/20">
                             <Eye className="h-4 w-4" /> Track "{data.meta.searchTerm}" Daily
                         </button>
                     </div>
                 )}
                 
                 {/* Top Stats Cards */}
                 <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                   <StatCard icon={<Package className="text-blue-400" />} label="Total Sold" value={data.meta.totalListings} subtext={`Last ${data.meta.targetDays} days`} />
                   <StatCard icon={<DollarSign className="text-emerald-400" />} label="Average Price" value={`$${data.stats.price.mean}`} subtext={`Median: $${data.stats.price.median}`} />
                   <StatCard icon={<TrendingUp className="text-purple-400" />} label="Sales Velocity" value={`${data.stats.velocity.avgPerDay}`} subtext="sales per day" />
                   <StatCard icon={<Calendar className="text-orange-400" />} label="Peak Day" value={data.stats.velocity.peakDay} subtext={`${data.stats.velocity.peakDaySales} sold`} />
                   <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-slate-700 transition-all shadow-sm flex flex-col justify-between">
                     <div className="flex items-center justify-between mb-2"><div className="p-2 bg-slate-950 rounded-lg border border-slate-800"><Filter className="text-teal-400 h-5 w-5" /></div><span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Condition</span></div>
                     <div>
                       <div className="flex justify-between items-end mb-2"><div><div className="text-2xl font-bold text-slate-100">{data.stats.newVsUsed?.newPct || 0}%</div><div className="text-xs text-slate-400">New</div></div><div className="text-right"><div className="text-2xl font-bold text-slate-100">{data.stats.newVsUsed?.usedPct || 0}%</div><div className="text-xs text-slate-400">Used</div></div></div>
                       <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden flex"><div className="h-full bg-emerald-500" style={{ width: `${data.stats.newVsUsed?.newPct || 0}%` }} title={`New: ${data.stats.newVsUsed?.newCount || 0}`} /><div className="h-full bg-blue-500" style={{ width: `${data.stats.newVsUsed?.usedPct || 0}%` }} title={`Used: ${data.stats.newVsUsed?.usedCount || 0}`} /></div>
                     </div>
                   </div>
                 </div>

                 {/* Charts */}
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                   <ChartCard title="Daily Sales Volume">
                     <BarChart data={data.stats.velocity.dailyBreakdown}>
                       <CartesianGrid strokeDasharray="3 3" stroke="#334155" /><XAxis dataKey="date" stroke="#94a3b8" tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, {month:'short', day:'numeric'})} /><YAxis stroke="#94a3b8" /><Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#f8fafc' }} /><Bar dataKey="sold" fill="#60a5fa" radius={[4, 4, 0, 0]} />
                     </BarChart>
                   </ChartCard>
                   <ChartCard title="Price Distribution">
                     <BarChart data={data.stats.priceBuckets} layout="vertical">
                       <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} /><XAxis type="number" stroke="#94a3b8" /><YAxis dataKey="range" type="category" stroke="#94a3b8" width={80} /><Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155' }} /><Bar dataKey="count" fill="#34d399" radius={[0, 4, 4, 0]} />
                     </BarChart>
                   </ChartCard>
                 </div>
                 <ChartCard title="Individual Sales (Price vs Date)">
                   <ResponsiveContainer width="100%" height={300}>
                     <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                       <CartesianGrid strokeDasharray="3 3" stroke="#334155" /><XAxis type="number" dataKey="soldTimestamp" name="Date" domain={['auto', 'auto']} tickFormatter={(unixTime) => new Date(unixTime).toLocaleDateString()} stroke="#94a3b8" /><YAxis type="number" dataKey="price" name="Price" unit="$" stroke="#94a3b8" /><Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => { if (active && payload && payload.length) { const d = payload[0].payload; return ( <div className="bg-slate-800 border border-slate-700 p-3 rounded shadow-lg text-xs"><p className="font-bold text-slate-200 mb-1">{d.title}</p><p className="text-emerald-400 font-mono text-base">${d.price}</p><p className="text-slate-400">{new Date(d.soldTimestamp).toLocaleDateString()} {d.condition}</p></div> ); } return null; }} />
                       <Scatter name="Sales" data={data.listings.filter(l => l.soldTimestamp)} fill="#8884d8">{data.listings.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.condition.includes('New') ? '#34d399' : '#60a5fa'} />)}</Scatter>
                     </ScatterChart>
                   </ResponsiveContainer>
                 </ChartCard>

                 {/* Tables */}
                 <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                   <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                     <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><DollarSign className="text-emerald-400 h-5 w-5" /> Market Cheat Sheet</h3>
                     <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                       <table className="w-full text-sm text-left">
                         <thead className="text-xs text-slate-400 uppercase bg-slate-950/80 sticky top-0 backdrop-blur-sm"><tr><th className="px-4 py-3 rounded-l-lg">Model / Group</th><th className="px-4 py-3 text-right">Avg Price</th><th className="px-4 py-3 text-right text-emerald-400">Target Buy</th><th className="px-4 py-3 text-right rounded-r-lg">Volatility</th></tr></thead>
                         <tbody>{data.opportunities.groups.filter(g => parseInt(g.sold) > 2).sort((a, b) => parseFloat(b.priceSpread) - parseFloat(a.priceSpread)).slice(0, 20).map((group, idx) => (<tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors"><td className="px-4 py-3 font-medium text-slate-200"><div className="truncate max-w-[180px]" title={group.group}>{group.group}</div><div className="text-xs text-slate-500">{group.sold} sold</div></td><td className="px-4 py-3 text-right text-slate-300">${group.avgPrice}</td><td className="px-4 py-3 text-right font-bold text-emerald-400">${group.minPrice}</td><td className="px-4 py-3 text-right text-blue-400">{group.priceSpread}</td></tr>))}</tbody>
                       </table>
                     </div>
                   </div>
                   <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 flex flex-col">
                     <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-semibold flex items-center gap-2"><TrendingUp className="text-purple-400 h-5 w-5" /> Top Keywords</h3><div className="flex bg-slate-800 rounded-lg p-1 overflow-x-auto">{[2, 3, 4, 5, 6].map(n => (<button key={n} onClick={() => setNgramSize(n)} className={`px-3 py-1 text-xs font-medium rounded-md transition-all whitespace-nowrap ${ngramSize === n ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>{n}-Word</button>))}</div></div>
                     <div className="flex flex-wrap gap-2 content-start overflow-y-auto max-h-[350px]">
                       {getCurrentNgrams().slice(0, 20).map((tag, idx) => (<button key={idx} onClick={() => setListingFilter(tag.term)} className={`text-xs px-3 py-1.5 rounded-full transition-all border cursor-pointer ${listingFilter === tag.term ? 'bg-purple-500 border-purple-400 text-white ring-2 ring-purple-500/30' : 'bg-slate-800 hover:bg-slate-700 text-blue-200 border-slate-700 hover:border-slate-600'}`}>{tag.term} <span className="opacity-60 ml-1">({tag.sold})</span></button>))}
                     </div>
                   </div>
                 </div>
                 <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                    <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-semibold flex items-center gap-2"><Package className="text-blue-400 h-5 w-5" /> Sold Listings Reference</h3>{listingFilter && <button onClick={() => setListingFilter('')} className="flex items-center gap-1 text-xs bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full hover:bg-purple-500/30 transition-colors">Filtered by: "{listingFilter}" <X className="h-3 w-3" /></button>}</div>
                     <ListingsTable listings={data.listings} initialFilter={listingFilter} />
                 </div>
               </>
             )}
           </div>
        )}
      </div>
    </div>
  );
}

function ListingsTable({ listings, initialFilter }) {
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(50);
  useEffect(() => { if (initialFilter !== undefined) setFilter(initialFilter); }, [initialFilter]);
  useEffect(() => { setLimit(50); }, [filter, listings]);
  const sorted = [...listings].sort((a, b) => (b.soldTimestamp || 0) - (a.soldTimestamp || 0));
  const filtered = sorted.filter(l => l.title.toLowerCase().includes(filter.toLowerCase()));
  const visible = filtered.slice(0, limit);
  const handleScroll = (e) => { const { scrollTop, scrollHeight, clientHeight } = e.target; if (scrollHeight - scrollTop - clientHeight < 50) setLimit(prev => prev + 50); };

  return (
    <div>
      <div className="relative mb-4"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input type="text" placeholder="Filter listings by title..." className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={filter} onChange={e => setFilter(e.target.value)} /></div>
      <div className="max-h-[600px] overflow-y-auto overflow-x-auto scroll-smooth border border-slate-800 rounded-lg" onScroll={handleScroll}>
        <table className="w-full text-sm text-left min-w-[600px]">
          <thead className="text-xs text-slate-400 uppercase bg-slate-950 sticky top-0 z-10 shadow-lg">
            <tr><th className="px-4 py-3 bg-slate-950 w-16">Image</th><th className="px-4 py-3 bg-slate-950 w-24">Date</th><th className="px-4 py-3 bg-slate-950">Title</th><th className="px-4 py-3 bg-slate-950 w-24">Price</th><th className="px-4 py-3 bg-slate-950 w-32">Condition</th><th className="px-4 py-3 bg-slate-950 w-20 text-right">Link</th></tr>
          </thead>
          <tbody>
            {visible.map((item, idx) => (
              <tr key={idx} className="border-b border-slate-800 hover:bg-slate-800/50 transition-colors">
                <td className="px-4 py-3 align-top">{item.image ? (<div className="relative group"><img src={item.image} alt="Thumbnail" className="w-10 h-10 object-cover rounded border border-slate-700" loading="lazy" /><div className="absolute left-12 top-0 w-48 h-48 hidden group-hover:block z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl overflow-hidden p-1 pointer-events-none"><img src={item.image} alt="Preview" className="w-full h-full object-contain bg-white rounded" /></div></div>) : (<div className="w-10 h-10 bg-slate-800 rounded flex items-center justify-center border border-slate-700"><Package className="h-4 w-4 text-slate-600" /></div>)}</td>
                <td className="px-4 py-3 text-slate-400 whitespace-nowrap text-xs align-top">{item.soldTimestamp ? new Date(item.soldTimestamp).toLocaleDateString() : '-'}</td>
                <td className="px-4 py-3 font-medium text-slate-200 align-top"><div className="break-words whitespace-normal line-clamp-2 hover:line-clamp-none transition-all" title={item.title}>{item.title}</div></td>
                <td className="px-4 py-3 text-emerald-400 font-mono align-top">${item.price.toFixed(2)}</td>
                <td className="px-4 py-3 align-top"><span className={`inline-block px-2 py-1 rounded-full text-xs whitespace-nowrap ${item.condition.includes('New') ? 'bg-emerald-500/10 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}`}>{item.condition}</span></td>
                <td className="px-4 py-3 text-right align-top"><a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 inline-flex items-center">View <ExternalLink className="h-3 w-3 ml-1" /></a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, subtext }) {
  return (
    <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 hover:border-slate-700 transition-all shadow-sm">
      <div className="flex items-start justify-between mb-4"><div className="p-2 bg-slate-950 rounded-lg border border-slate-800">{icon}</div></div>
      <div className="text-3xl font-bold text-slate-100 mb-1">{value}</div>
      <div className="text-sm font-medium text-slate-400">{label}</div>
      {subtext && <div className="text-xs text-slate-500 mt-1">{subtext}</div>}
    </div>
  );
}

function ChartCard({ title, children }) {
  return (
    <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
      <h3 className="text-lg font-semibold mb-6 text-slate-200">{title}</h3>
      <div className="h-[300px] w-full"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </div>
  );
}