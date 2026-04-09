import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Music,
  Heart,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Repeat,
  MessageSquareQuote,
  Search,
  ListMusic,
  Copy,
  Loader2,
  X,
  ArrowLeft,
  Lock,
  Users
} from 'lucide-react';
import FriendsMenu from './FriendsMenu';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, setDoc, collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, orderBy, limit } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './firebase';

interface Song {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  audioUrl: string;
  duration?: number;
}

interface Playlist {
  id: string;
  userId: string;
  name: string;
  songs: Song[];
  isFavorites?: boolean;
  createdAt: number;
}

export default function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<Song[]>([]);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [syncedLyrics, setSyncedLyrics] = useState<{time: number, text: string}[] | null>(null);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);
  const [rightPanelView, setRightPanelView] = useState<'search' | 'playlist' | 'queue' | 'lyrics'>('search');

  const activeLyricIndex = useMemo(() => {
    if (!syncedLyrics) return -1;
    for (let i = syncedLyrics.length - 1; i >= 0; i--) {
      if (progress >= syncedLyrics[i].time) {
        return i;
      }
    }
    return -1;
  }, [progress, syncedLyrics]);

  useEffect(() => {
    if (rightPanelView === 'lyrics' && activeLyricIndex !== -1) {
      const el = document.getElementById(`lyric-${activeLyricIndex}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeLyricIndex, rightPanelView]);

  const [isLooping, setIsLooping] = useState(false);
  const [showFriendsMenu, setShowFriendsMenu] = useState(false);
  const [currentUserUid, setCurrentUserUid] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<{ photoURL?: string, displayName?: string, isBanned?: boolean } | null>(null);
  const [globalAnnouncement, setGlobalAnnouncement] = useState<{ text: string, authorName: string } | null>(null);
  
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<Playlist | null>(null);
  const [showCreatePlaylist, setShowCreatePlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [showAddToPlaylistFor, setShowAddToPlaylistFor] = useState<string | null>(null);

  const [queue, setQueue] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const queueRef = useRef<Song[]>([]);
  const queueIndexRef = useRef<number>(-1);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const playSongFromList = (song: Song, list: Song[]) => {
    setQueue(list);
    queueRef.current = list;
    const idx = list.findIndex(s => s.id === song.id);
    setQueueIndex(idx);
    queueIndexRef.current = idx;
    setCurrentSong(song);
  };

  const playNext = () => {
    const q = queueRef.current;
    const idx = queueIndexRef.current;
    if (q.length === 0) return;
    let nextIndex = idx + 1;
    if (nextIndex >= q.length) {
      nextIndex = 0;
    }
    setQueueIndex(nextIndex);
    queueIndexRef.current = nextIndex;
    setCurrentSong(q[nextIndex]);
  };

  const playPrev = () => {
    const q = queueRef.current;
    const idx = queueIndexRef.current;
    if (q.length === 0) return;
    let prevIndex = idx - 1;
    if (prevIndex < 0) {
      prevIndex = q.length - 1;
    }
    setQueueIndex(prevIndex);
    queueIndexRef.current = prevIndex;
    setCurrentSong(q[prevIndex]);
  };

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeAnnouncements: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      setCurrentUserUid(user ? user.uid : null);
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeAnnouncements) unsubscribeAnnouncements();
      
      if (user) {
        unsubscribeProfile = onSnapshot(doc(db, 'users', user.uid), (docSnap) => {
          if (docSnap.exists()) {
            setUserProfile(docSnap.data());
          }
        }, (error) => handleFirestoreError(error, OperationType.GET, `users/${user.uid}`));

        const q = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(1));
        unsubscribeAnnouncements = onSnapshot(q, (snapshot) => {
          if (!snapshot.empty) {
            const latest = snapshot.docs[0].data();
            // Only show if it's relatively recent (e.g. last 10 minutes)
            if (latest.createdAt > Date.now() - 600000) {
              setGlobalAnnouncement({ text: latest.text, authorName: latest.authorName || 'Admin' });
              setTimeout(() => setGlobalAnnouncement(null), 10000);
            }
          }
        }, (error) => handleFirestoreError(error, OperationType.LIST, 'announcements'));
      } else {
        setUserProfile(null);
      }
    });
    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeAnnouncements) unsubscribeAnnouncements();
    };
  }, []);

  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    
    const audio = audioRef.current;
    
    const onTimeUpdate = () => {
      setProgress(audio.currentTime);
    };
    
    const onLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };
    
    const onEnded = () => {
      setIsLooping(currentLooping => {
        if (currentLooping) {
          audio.currentTime = 0;
          audio.play().catch(e => console.error("Playback failed", e));
        } else {
          const q = queueRef.current;
          const idx = queueIndexRef.current;
          if (q.length > 0) {
            let nextIndex = idx + 1;
            if (nextIndex >= q.length) {
              nextIndex = 0;
            }
            queueIndexRef.current = nextIndex;
            setQueueIndex(nextIndex); // This might cause a warning if called inside setState, but it's fine since we're in a functional update. Actually, better to just call it.
            // Wait, calling state setters inside another state setter's functional update is an anti-pattern.
            // Let's just use setTimeout to escape the functional update context.
            setTimeout(() => {
              setQueueIndex(nextIndex);
              setCurrentSong(q[nextIndex]);
            }, 0);
          } else {
            setIsPlaying(false);
            setProgress(0);
          }
        }
        return currentLooping;
      });
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, []);

  useEffect(() => {
    if (currentSong && audioRef.current) {
      const ensureProxied = (url: string, type: 'audio' | 'image') => {
        if (!url || url.startsWith('/') || url.startsWith('blob:') || url.startsWith('data:')) return url;
        if (url.includes('/api/proxy-')) return url;
        return `/api/proxy-${type}?url=${encodeURIComponent(url)}`;
      };

      if (currentSong.duration) {
        setDuration(currentSong.duration);
      }
      audioRef.current.src = ensureProxied(currentSong.audioUrl, 'audio');
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.then(() => setIsPlaying(true)).catch(error => {
          if (error.name === 'NotAllowedError') {
            setIsPlaying(false);
          } else if (error.name !== 'AbortError') {
            console.error("Playback failed", error);
          }
        });
      }
      
      fetchLyrics(currentSong.artist, currentSong.title);

      if (currentUserUid) {
        setDoc(doc(db, 'users', currentUserUid), {
          currentSong: {
            title: currentSong.title,
            artist: currentSong.artist,
            coverUrl: ensureProxied(currentSong.coverUrl, 'image')
          }
        }, { merge: true }).catch(console.error);
      }
    } else if (!currentSong && currentUserUid) {
      setDoc(doc(db, 'users', currentUserUid), {
        currentSong: null
      }, { merge: true }).catch(console.error);
    }
  }, [currentSong, currentUserUid]);

  useEffect(() => {
    if (audioRef.current) {
      if (isPlaying) {
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.catch(error => {
            if (error.name === 'NotAllowedError') {
              setIsPlaying(false);
            } else if (error.name !== 'AbortError') {
              console.error("Playback failed", error);
            }
          });
        }
      } else {
        audioRef.current.pause();
      }
    }
  }, [isPlaying]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = Number(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setProgress(time);
    }
  };

  useEffect(() => {
    if (!currentUserUid) {
      setPlaylists([]);
      return;
    }
    const q = query(collection(db, 'playlists'), where('userId', '==', currentUserUid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const lists: Playlist[] = [];
      let hasFavorites = false;
      snapshot.forEach(doc => {
        const data = doc.data() as Playlist;
        lists.push({ ...data, id: doc.id });
        if (data.isFavorites) hasFavorites = true;
      });
      
      lists.sort((a, b) => a.createdAt - b.createdAt);
      setPlaylists(lists);

      if (!hasFavorites) {
        addDoc(collection(db, 'playlists'), {
          userId: currentUserUid,
          name: 'Favorites',
          songs: [],
          isFavorites: true,
          createdAt: Date.now()
        }).catch(console.error);
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'playlists'));

    return () => unsubscribe();
  }, [currentUserUid]);

  const toggleFavorite = async (song: Song) => {
    if (!currentUserUid) return;
    const favorites = playlists.find(p => p.isFavorites);
    if (!favorites) return;

    const isFav = favorites.songs.some(s => s.id === song.id);
    const newSongs = isFav 
      ? favorites.songs.filter(s => s.id !== song.id)
      : [...favorites.songs, song];

    try {
      await updateDoc(doc(db, 'playlists', favorites.id), { songs: newSongs });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `playlists/${favorites.id}`);
    }
  };

  const createPlaylist = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUserUid || !newPlaylistName.trim()) return;

    try {
      await addDoc(collection(db, 'playlists'), {
        userId: currentUserUid,
        name: newPlaylistName.trim(),
        songs: [],
        createdAt: Date.now()
      });
      setShowCreatePlaylist(false);
      setNewPlaylistName('');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'playlists');
    }
  };

  const addToPlaylist = async (playlistId: string, song: Song) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    if (playlist.songs.some(s => s.id === song.id)) {
      setShowAddToPlaylistFor(null);
      return;
    }

    try {
      await updateDoc(doc(db, 'playlists', playlistId), {
        songs: [...playlist.songs, song]
      });
      setShowAddToPlaylistFor(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `playlists/${playlistId}`);
    }
  };

  const removeFromPlaylist = async (playlistId: string, songId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;

    try {
      await updateDoc(doc(db, 'playlists', playlistId), {
        songs: playlist.songs.filter(s => s.id !== songId)
      });
      if (activePlaylist?.id === playlistId) {
        setActivePlaylist({ ...playlist, songs: playlist.songs.filter(s => s.id !== songId) });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `playlists/${playlistId}`);
    }
  };

  const deletePlaylist = async (playlistId: string) => {
    try {
      await deleteDoc(doc(db, 'playlists', playlistId));
      if (activePlaylist?.id === playlistId) {
        setActivePlaylist(null);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `playlists/${playlistId}`);
    }
  };

  const searchMusic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    setSearchError(null);
    try {
      let formattedResults: Song[] = [];
      
      // Primary: JioSaavn unofficial API for full tracks
      try {
        let res;
        const targetUrl = `https://jiosaavn-api-privatecvc2.vercel.app/search/songs?query=${encodeURIComponent(searchQuery)}`;
        const proxies = [
          targetUrl, // Try direct first
          `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
          `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
        ];

        let lastError;
        for (const url of proxies) {
          try {
            res = await fetch(url);
            if (res.ok) break;
          } catch (e) {
            lastError = e;
            console.log(`Failed to fetch from ${url}, trying next...`);
          }
        }
        
        if (res && res.ok) {
          const data = await res.json();
          if (data?.data?.results?.length > 0) {
            formattedResults = data.data.results.map((item: any) => {
              // Decode HTML entities in title/artist
              const decodeHTML = (html: string) => {
                const txt = document.createElement('textarea');
                txt.innerHTML = html;
                return txt.value;
              };
              
              const highResImage = item.image?.find((img: any) => img.quality === '500x500')?.link || item.image?.[0]?.link || '';
              const highResAudio = item.downloadUrl?.find((url: any) => url.quality === '320kbps')?.link || item.downloadUrl?.[item.downloadUrl.length - 1]?.link || '';
              
              return {
                id: item.id,
                title: decodeHTML(item.name || ''),
                artist: decodeHTML(item.primaryArtists || ''),
                coverUrl: highResImage || '',
                audioUrl: highResAudio || '',
                duration: parseInt(item.duration || '0', 10)
              };
            }).filter((song: Song) => song.audioUrl);
          } else {
            setSearchError("No results found.");
          }
        } else if (res) {
          setSearchError(`Server returned ${res.status} ${res.statusText}`);
        } else {
          setSearchError("All API proxies failed. Your network might be blocking them.");
        }
      } catch (saavnError: any) {
        console.error("Saavn API failed", saavnError);
        setSearchError(`Failed to fetch: ${saavnError.message}`);
      }
      
      setResults(formattedResults);
    } catch (error: any) {
      console.error("Search failed", error);
      setSearchError(`Search failed: ${error.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const parseLrc = (lrc: string) => {
    const lines = lrc.split('\n');
    const parsed: { time: number, text: string }[] = [];
    const timeReg = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
    lines.forEach(line => {
      const match = timeReg.exec(line);
      if (match) {
        const min = parseInt(match[1]);
        const sec = parseInt(match[2]);
        const ms = parseInt(match[3]);
        const time = min * 60 + sec + ms / (match[3].length === 2 ? 100 : 1000);
        const text = line.replace(timeReg, '').trim();
        if (text) parsed.push({ time, text });
      }
    });
    return parsed;
  };

  const fetchLyrics = async (artist: string, title: string) => {
    setIsLoadingLyrics(true);
    setSyncedLyrics(null);
    setPlainLyrics(null);
    try {
      const cleanTitle = title.split('(')[0].split('feat.')[0].trim();
      let res;
      const targetUrl = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(cleanTitle)}`;
      const proxies = [
        targetUrl,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
      ];

      for (const url of proxies) {
        try {
          res = await fetch(url);
          if (res.ok) break;
        } catch (e) {
          console.log(`Lyrics fetch failed from ${url}, trying next...`);
        }
      }
      
      if (res && res.ok) {
        const data = await res.json();
        if (data.syncedLyrics) {
          setSyncedLyrics(parseLrc(data.syncedLyrics));
        } else if (data.plainLyrics) {
          setPlainLyrics(data.plainLyrics);
        } else {
          setPlainLyrics("Lyrics not found for this track.");
        }
      } else {
        setPlainLyrics("Lyrics not found for this track.");
      }
    } catch (error) {
      setPlainLyrics("Could not load lyrics.");
    } finally {
      setIsLoadingLyrics(false);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time) || !isFinite(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (userProfile?.isBanned) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Lock className="text-red-500" size={40} />
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Account Banned</h1>
          <p className="text-gray-400 mb-8 leading-relaxed">
            Your account has been permanently banned from the platform for violating our community guidelines. 
            If you believe this is a mistake, please contact support.
          </p>
          <button 
            onClick={() => auth.signOut()}
            className="bg-white text-black px-8 py-3 rounded-xl font-bold hover:bg-gray-200 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1115] flex items-center justify-center p-4 font-sans text-gray-200 relative overflow-hidden">
      {/* Global Announcement Banner */}
      {globalAnnouncement && (
        <div className="fixed top-0 left-0 right-0 bg-blue-600 text-white px-4 py-2 text-center text-sm font-medium animate-in slide-in-from-top duration-300 z-[100]">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <Music size={16} className="animate-pulse" />
            <span>
              <strong className="uppercase tracking-wider mr-2">{globalAnnouncement.authorName}:</strong> 
              {globalAnnouncement.text}
            </span>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 w-full max-w-5xl h-[800px] max-h-[90vh] z-10">
        
        {/* Left Panel - Player */}
        <div className="w-full md:w-[400px] bg-[#22272e] rounded-2xl p-6 flex flex-col shadow-2xl relative overflow-hidden">
          
          {/* Album Art */}
          <div className="w-full aspect-square bg-[#2d333b] rounded-xl flex items-center justify-center mb-6 overflow-hidden shadow-inner relative group">
            {currentSong ? (
              <img src={currentSong.coverUrl} alt="Album Art" className="w-full h-full object-cover" />
            ) : (
              <Music size={120} className="text-[#444c56]" />
            )}
            
            {/* User Profile Overlay (Top Left) */}
            {userProfile && (
              <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/40 backdrop-blur-md p-1.5 pr-3 rounded-full border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                {userProfile.photoURL ? (
                  <img 
                    key={userProfile.photoURL}
                    src={userProfile.photoURL} 
                    alt="Me" 
                    className="w-8 h-8 rounded-full object-cover border border-white/20" 
                    referrerPolicy="no-referrer" 
                  />
                ) : (
                  <div className="w-8 h-8 bg-[#444c56] rounded-full flex items-center justify-center border border-white/20">
                    <Users size={14} className="text-white" />
                  </div>
                )}
                <span className="text-xs font-medium text-white truncate max-w-[80px]">{userProfile.displayName}</span>
              </div>
            )}
          </div>

          {/* Song Info */}
          <div className="flex justify-between items-start mb-6">
            <div className="flex-1 overflow-hidden pr-4">
              <h2 className="text-xl font-bold text-white truncate flex items-center gap-2">
                {!currentSong && <span className="text-[#8b949e] font-normal tracking-widest text-sm">-----</span>}
                {currentSong ? currentSong.title : "Not Playing"}
              </h2>
              <p className="text-[#8b949e] truncate mt-1">
                {currentSong ? currentSong.artist : "Try searching on the right"}
              </p>
            </div>
            <button 
              onClick={() => currentSong && toggleFavorite(currentSong)}
              className="text-[#8b949e] hover:text-white transition-colors mt-1 outline-none"
            >
              <Heart 
                size={24} 
                className={currentSong && playlists.find(p => p.isFavorites)?.songs.some(s => s.id === currentSong.id) ? "text-red-500 fill-red-500" : ""} 
              />
            </button>
          </div>

          {/* Progress Bar */}
          <div className="mb-8">
            <input
              type="range"
              min="0"
              max={duration || 100}
              step="any"
              value={progress}
              onChange={handleSeek}
              className="w-full h-1.5 bg-[#444c56] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full"
              style={{
                background: `linear-gradient(to right, #e2e8f0 ${(progress / (duration || 1)) * 100}%, #444c56 ${(progress / (duration || 1)) * 100}%)`
              }}
            />
            <div className="flex justify-between text-xs text-[#8b949e] mt-2 font-mono">
              <span>{formatTime(progress)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-center mt-auto relative">
            <button 
              onClick={() => setIsLooping(!isLooping)}
              className={`absolute left-0 p-2 outline-none transition-all duration-300 ${isLooping ? 'text-white scale-110 drop-shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'text-[#8b949e] hover:text-white'}`}
            >
              <Repeat size={20} />
            </button>
            
            <div className="flex items-center gap-6">
              <button onClick={playPrev} className="text-white hover:text-gray-300 transition-colors outline-none">
                <SkipBack size={32} fill="currentColor" />
              </button>
              
              <button 
                onClick={() => currentSong && setIsPlaying(!isPlaying)}
                className="w-16 h-16 bg-[#e2e8f0] rounded-full flex items-center justify-center text-[#22272e] hover:scale-105 transition-transform shadow-lg outline-none"
              >
                {isPlaying ? (
                  <Pause size={32} fill="currentColor" />
                ) : (
                  <Play size={32} fill="currentColor" className="ml-1" />
                )}
              </button>
              
              <button onClick={playNext} className="text-white hover:text-gray-300 transition-colors outline-none">
                <SkipForward size={32} fill="currentColor" />
              </button>
            </div>

            <button 
              onClick={() => setRightPanelView(prev => prev === 'lyrics' ? 'search' : 'lyrics')}
              className={`absolute right-0 p-2 outline-none transition-colors ${rightPanelView === 'lyrics' ? 'text-white' : 'text-[#8b949e] hover:text-white'}`}
            >
              <MessageSquareQuote size={20} />
            </button>
          </div>
        </div>

        {/* Right Panel - Search & Playlist */}
        <div className="flex-1 bg-[#22272e] rounded-2xl flex flex-col shadow-2xl overflow-hidden">
          
          {rightPanelView === 'search' && (
            <>
              {/* Search Header */}
              <div className="p-4 border-b border-[#30363d]">
                <div className="bg-[#2d333b] rounded-xl flex items-center px-4 py-3">
                  <Search size={20} className="text-[#8b949e]" />
                  <form onSubmit={searchMusic} className="flex-1 ml-3">
                    <input
                      type="text"
                      placeholder="Search any song"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-transparent border-none outline-none text-white placeholder-[#8b949e]"
                    />
                  </form>
                  <div className="flex items-center gap-4 text-[#8b949e] ml-4 border-l border-[#444c56] pl-4">
                    <button onClick={() => setShowFriendsMenu(true)} className="hover:text-white transition-colors outline-none" title="Friends">
                      <Users size={20} />
                    </button>
                    <button onClick={() => { setRightPanelView('playlist'); setActivePlaylist(null); }} className="hover:text-white transition-colors outline-none" title="Playlist">
                      <ListMusic size={20} />
                    </button>
                    <button onClick={() => setRightPanelView('queue')} className="hover:text-white transition-colors outline-none" title="Queue">
                      <Copy size={20} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Content Area */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
                {isSearching ? (
                  <div className="flex flex-col items-center justify-center h-full text-[#8b949e]">
                    <Loader2 className="animate-spin mb-4" size={48} />
                    <p>Searching sources...</p>
                  </div>
                ) : searchError ? (
                  <div className="flex flex-col items-center justify-center h-full text-red-400 p-4 text-center">
                    <p className="mb-2 font-medium">Search failed</p>
                    <p className="text-sm opacity-80">{searchError}</p>
                  </div>
                ) : results.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {results.map((song) => (
                      <div
                        key={song.id}
                        onClick={() => playSongFromList(song, results)}
                        className={`flex items-center gap-4 p-3 rounded-xl transition-colors text-left w-full outline-none cursor-pointer
                          ${currentSong?.id === song.id ? 'bg-[#2d333b]' : 'hover:bg-[#2d333b]/50'}`}
                      >
                        <img src={song.coverUrl} alt={song.title} className="w-12 h-12 rounded-md object-cover" />
                        <div className="flex-1 overflow-hidden">
                          <h4 className={`font-medium truncate ${currentSong?.id === song.id ? 'text-white' : 'text-gray-200'}`}>
                            {song.title}
                          </h4>
                          <p className="text-sm text-[#8b949e] truncate">{song.artist}</p>
                        </div>
                        
                        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                          <button 
                            onClick={() => toggleFavorite(song)}
                            className="p-2 hover:bg-[#444c56] rounded-full transition-colors outline-none"
                          >
                            <Heart 
                              size={18} 
                              className={playlists.find(p => p.isFavorites)?.songs.some(s => s.id === song.id) ? "text-red-500 fill-red-500" : "text-[#8b949e] hover:text-white"} 
                            />
                          </button>
                          <div className="relative">
                            <button 
                              onClick={() => setShowAddToPlaylistFor(showAddToPlaylistFor === song.id ? null : song.id)}
                              className="p-2 hover:bg-[#444c56] rounded-full transition-colors outline-none text-[#8b949e] hover:text-white"
                            >
                              <span className="text-xl leading-none">+</span>
                            </button>
                            {showAddToPlaylistFor === song.id && (
                              <div className="absolute right-0 mt-2 w-48 bg-[#2d333b] border border-[#444c56] rounded-xl shadow-2xl z-50 py-2">
                                <div className="px-3 py-1 text-xs font-medium text-gray-400 uppercase tracking-wider">Add to Playlist</div>
                                {playlists.filter(p => !p.isFavorites).map(p => (
                                  <button
                                    key={p.id}
                                    onClick={() => addToPlaylist(p.id, song)}
                                    className="w-full text-left px-4 py-2 hover:bg-[#444c56] text-sm text-white transition-colors"
                                  >
                                    {p.name}
                                  </button>
                                ))}
                                {playlists.filter(p => !p.isFavorites).length === 0 && (
                                  <div className="px-4 py-2 text-sm text-gray-500">No playlists yet</div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {currentSong?.id === song.id && isPlaying && (
                          <div className="flex gap-1 items-end h-4 mr-2">
                            <div className="w-1 bg-white animate-[bounce_1s_infinite] h-full"></div>
                            <div className="w-1 bg-white animate-[bounce_1s_infinite_0.2s] h-2/3"></div>
                            <div className="w-1 bg-white animate-[bounce_1s_infinite_0.4s] h-full"></div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-[#8b949e]">
                    <Search size={64} className="mb-6 opacity-50" />
                    <p className="text-lg">Try searching "metal"</p>
                  </div>
                )}
              </div>
            </>
          )}

          {rightPanelView === 'playlist' && (
            <>
              <div className="p-4 flex items-center justify-between text-[#8b949e] border-b border-[#30363d]">
                <button 
                  onClick={() => activePlaylist ? setActivePlaylist(null) : setRightPanelView('search')} 
                  className="flex items-center gap-2 hover:text-white transition-colors outline-none"
                >
                  <ArrowLeft size={20} />
                  <span>{activePlaylist ? 'Back to Playlists' : 'Back to search'}</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-2">
                {!currentUserUid ? (
                  <div className="flex flex-col items-center justify-center h-full text-[#8b949e]">
                    <ListMusic size={64} className="mb-6 opacity-50" />
                    <p className="text-lg">Sign in to create playlists</p>
                  </div>
                ) : activePlaylist ? (
                  <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-4">
                        <div className={`w-16 h-16 rounded-xl flex items-center justify-center ${activePlaylist.isFavorites ? 'bg-yellow-500/20 text-yellow-500' : 'bg-[#444c56] text-white'}`}>
                          {activePlaylist.isFavorites ? <Heart size={32} fill="currentColor" /> : <ListMusic size={32} />}
                        </div>
                        <div>
                          <h2 className="text-2xl font-bold text-white">{activePlaylist.name}</h2>
                          <p className="text-[#8b949e]">{activePlaylist.songs.length} Songs</p>
                        </div>
                      </div>
                      {!activePlaylist.isFavorites && (
                        <button 
                          onClick={() => deletePlaylist(activePlaylist.id)}
                          className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    
                    {activePlaylist.songs.length === 0 ? (
                      <div className="text-center text-[#8b949e] py-8">
                        <p>No songs in this playlist yet.</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {activePlaylist.songs.map((song) => (
                          <div
                            key={song.id}
                            className={`flex items-center gap-4 p-3 rounded-xl transition-colors text-left w-full outline-none group
                              ${currentSong?.id === song.id ? 'bg-[#2d333b]' : 'hover:bg-[#2d333b]/50'}`}
                          >
                            <button onClick={() => playSongFromList(song, activePlaylist.songs)} className="flex-1 flex items-center gap-4 text-left">
                              <img src={song.coverUrl} alt={song.title} className="w-10 h-10 rounded-md object-cover" />
                              <div className="flex-1 overflow-hidden">
                                <h4 className={`font-medium truncate ${currentSong?.id === song.id ? 'text-white' : 'text-gray-200'}`}>
                                  {song.title}
                                </h4>
                                <p className="text-sm text-[#8b949e] truncate">{song.artist}</p>
                              </div>
                            </button>
                            <button 
                              onClick={() => removeFromPlaylist(activePlaylist.id, song.id)}
                              className="p-2 text-[#8b949e] hover:text-red-400 hover:bg-[#444c56] rounded-full transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    {showCreatePlaylist ? (
                      <form onSubmit={createPlaylist} className="bg-[#2d333b] p-4 rounded-xl mb-4">
                        <input
                          type="text"
                          placeholder="Playlist Name"
                          value={newPlaylistName}
                          onChange={e => setNewPlaylistName(e.target.value)}
                          className="w-full bg-[#1c2128] text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-white/20 mb-3"
                          autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                          <button 
                            type="button" 
                            onClick={() => setShowCreatePlaylist(false)}
                            className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button 
                            type="submit"
                            className="px-4 py-2 text-sm bg-white text-black rounded-lg font-medium hover:bg-gray-200"
                          >
                            Create
                          </button>
                        </div>
                      </form>
                    ) : (
                      <button 
                        onClick={() => setShowCreatePlaylist(true)}
                        className="flex items-center gap-4 p-4 rounded-xl bg-[#2d333b] hover:bg-[#30363d] transition-colors text-left w-full outline-none"
                      >
                        <div className="w-12 h-12 flex items-center justify-center text-gray-400">
                          <span className="text-2xl">+</span>
                        </div>
                        <span className="font-medium text-white">Create Playlist</span>
                      </button>
                    )}

                    {playlists.map(playlist => (
                      <button 
                        key={playlist.id}
                        onClick={() => setActivePlaylist(playlist)}
                        className="flex items-center gap-4 p-4 rounded-xl bg-[#2d333b] hover:bg-[#30363d] transition-colors text-left w-full outline-none"
                      >
                        <div className={`w-12 h-12 rounded-md flex items-center justify-center ${playlist.isFavorites ? 'bg-yellow-500/20 text-yellow-500' : 'bg-[#444c56] text-white'}`}>
                          {playlist.isFavorites ? <Heart size={24} fill="currentColor" /> : <ListMusic size={24} />}
                        </div>
                        <div>
                          <h4 className="font-medium text-white">{playlist.name}</h4>
                          <p className="text-sm text-[#8b949e]">{playlist.songs.length} Songs</p>
                        </div>
                      </button>
                    ))}
                  </>
                )}
              </div>
            </>
          )}

          {rightPanelView === 'queue' && (
            <>
              <div className="p-4 flex items-center justify-between text-[#8b949e]">
                <button onClick={() => setRightPanelView('search')} className="flex items-center gap-2 hover:text-white transition-colors outline-none">
                  <ArrowLeft size={20} />
                  <span>Back to search</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">Queue</span>
                  <Lock size={16} />
                </div>
              </div>
              <div className="flex-1 flex items-center justify-center text-[#8b949e]">
                <p>No songs are playing.</p>
              </div>
            </>
          )}

          {rightPanelView === 'lyrics' && (
            <>
              <div className="p-4 flex items-center justify-between text-[#8b949e]">
                <button onClick={() => setRightPanelView('search')} className="flex items-center gap-2 hover:text-white transition-colors outline-none">
                  <ArrowLeft size={20} />
                  <span>Back to search</span>
                </button>
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium">Lyrics</span>
                  <MessageSquareQuote size={16} />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
                {isLoadingLyrics ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="animate-spin text-gray-400" size={32} />
                  </div>
                ) : syncedLyrics ? (
                  <div className="flex flex-col gap-4 pb-[50vh]">
                    {syncedLyrics.map((lyric, index) => {
                      const isActive = index === activeLyricIndex;
                      const isPassed = index < activeLyricIndex;
                      return (
                        <p
                          key={index}
                          id={`lyric-${index}`}
                          className={`text-2xl md:text-3xl font-bold transition-all duration-300 cursor-pointer
                            ${isActive ? 'text-white scale-105 origin-left' : isPassed ? 'text-white/50' : 'text-[#8b949e]/40 hover:text-white/60'}`}
                          onClick={() => {
                            if (audioRef.current) {
                              audioRef.current.currentTime = lyric.time;
                            }
                          }}
                        >
                          {lyric.text}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap font-sans text-lg leading-relaxed text-gray-300">
                    {plainLyrics || "No lyrics available."}
                  </pre>
                )}
              </div>
            </>
          )}

          {showFriendsMenu && <FriendsMenu onClose={() => setShowFriendsMenu(false)} />}
        </div>
      </div>
      
      <div className="absolute bottom-4 text-[#444c56] text-xs flex gap-4 opacity-50 hover:opacity-100 transition-opacity">
        <span>awdre was here</span>
        <span>•</span>
        <span>keep using thisss</span>
        <span>•</span>
        <span>i love you &lt;3</span>
        <span>•</span>
        <span>not even doing ur work gng</span>
      </div>
    </div>
  );
}
