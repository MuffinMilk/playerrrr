import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Check, X, Copy, LogIn, LogOut, Loader2, Music, ArrowLeft, Camera } from 'lucide-react';
import { auth, db, storage } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { collection, query, where, onSnapshot, setDoc, doc, getDocs, deleteDoc, addDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { handleFirestoreError, OperationType } from './firebase';

interface FriendRequest {
  id: string;
  fromUid: string;
  fromName: string;
  fromPhoto: string;
  toUid: string;
  status: string;
  createdAt: number;
}

interface Friendship {
  id: string;
  user1: string;
  user2: string;
  createdAt: number;
}

interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  friendCode: string;
  typingTo?: string;
  currentSong?: {
    title: string;
    artist: string;
    coverUrl: string;
  };
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  text: string;
  createdAt: number;
}

export default function FriendsMenu({ onClose }: { onClose: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  
  // Chat states
  const [activeChat, setActiveChat] = useState<UserProfile | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const typingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Auth states
  const [authMode, setAuthMode] = useState<'select' | 'login' | 'signup'>('select');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeRequests: (() => void) | null = null;
    let unsubF1: (() => void) | null = null;
    let unsubF2: (() => void) | null = null;
    let unsubFriends: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      // Cleanup previous listeners
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeRequests) unsubscribeRequests();
      if (unsubF1) unsubF1();
      if (unsubF2) unsubF2();
      if (unsubFriends) unsubFriends();

      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        unsubscribeProfile = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            setProfile(docSnap.data() as UserProfile);
          } else {
            const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const newProfile = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || 'Anonymous',
              photoURL: currentUser.photoURL || '',
              friendCode: newCode
            };
            setDoc(userRef, newProfile).catch(console.error);
          }
        }, (error) => handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`));

        const qRequests = query(collection(db, 'friendRequests'), where('toUid', '==', currentUser.uid));
        unsubscribeRequests = onSnapshot(qRequests, (snapshot) => {
          const reqs: FriendRequest[] = [];
          snapshot.forEach(doc => reqs.push({ id: doc.id, ...doc.data() } as FriendRequest));
          setRequests(reqs);
        }, (error) => handleFirestoreError(error, OperationType.LIST, 'friendRequests'));

        const qFriendships1 = query(collection(db, 'friendships'), where('user1', '==', currentUser.uid));
        const qFriendships2 = query(collection(db, 'friendships'), where('user2', '==', currentUser.uid));
        
        const handleFriendships = async (snapshot1: any, snapshot2: any) => {
          const friendUids = new Set<string>();
          snapshot1?.forEach((doc: any) => friendUids.add(doc.data().user2));
          snapshot2?.forEach((doc: any) => friendUids.add(doc.data().user1));
          
          if (unsubFriends) {
            unsubFriends();
            unsubFriends = null;
          }

          if (friendUids.size > 0) {
            const qFriends = query(collection(db, 'users'), where('uid', 'in', Array.from(friendUids)));
            unsubFriends = onSnapshot(qFriends, (friendsSnap) => {
              const fList: UserProfile[] = [];
              friendsSnap.forEach(doc => fList.push(doc.data() as UserProfile));
              setFriends(fList);
            }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
          } else {
            setFriends([]);
          }
        };

        let snap1: any, snap2: any;
        unsubF1 = onSnapshot(qFriendships1, (s) => { snap1 = s; handleFriendships(snap1, snap2); }, (error) => handleFirestoreError(error, OperationType.LIST, 'friendships'));
        unsubF2 = onSnapshot(qFriendships2, (s) => { snap2 = s; handleFriendships(snap1, snap2); }, (error) => handleFirestoreError(error, OperationType.LIST, 'friendships'));

        setLoading(false);
      } else {
        setProfile(null);
        setRequests([]);
        setFriends([]);
        setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeRequests) unsubscribeRequests();
      if (unsubF1) unsubF1();
      if (unsubF2) unsubF2();
      if (unsubFriends) unsubFriends();
    };
  }, []);

  useEffect(() => {
    if (!user || !activeChat) {
      setMessages([]);
      return;
    }

    const q1 = query(
      collection(db, 'messages'),
      where('senderId', '==', user.uid),
      where('receiverId', '==', activeChat.uid)
    );
    const q2 = query(
      collection(db, 'messages'),
      where('senderId', '==', activeChat.uid),
      where('receiverId', '==', user.uid)
    );

    let msgs1: Message[] = [];
    let msgs2: Message[] = [];

    const updateMessages = () => {
      const allMsgs = [...msgs1, ...msgs2].sort((a, b) => a.createdAt - b.createdAt);
      setMessages(allMsgs);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    };

    const unsub1 = onSnapshot(q1, (snap) => {
      msgs1 = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      updateMessages();
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'messages'));

    const unsub2 = onSnapshot(q2, (snap) => {
      msgs2 = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      updateMessages();
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'messages'));

    return () => {
      unsub1();
      unsub2();
    };
  }, [user, activeChat]);

  useEffect(() => {
    if (!activeChat && user) {
      setDoc(doc(db, 'users', user.uid), { typingTo: '' }, { merge: true }).catch(console.error);
    }
  }, [activeChat, user]);

  const handleLogin = async () => {
    try {
      setAuthError('');
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message);
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(userCredential.user, { displayName: username });
      
      // Update the user document with the new displayName since onAuthStateChanged 
      // might have fired before updateProfile finished
      const userRef = doc(db, 'users', userCredential.user.uid);
      await setDoc(userRef, { displayName: username }, { merge: true });
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/email-already-in-use') {
        setAuthError('An account with this email already exists. Please sign in instead.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setAuthError('Email/Password sign-in is not enabled. Please enable it in the Firebase Console under Authentication > Sign-in method.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('Password should be at least 6 characters.');
      } else {
        setAuthError(err.message);
      }
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setAuthError('Invalid email or password.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setAuthError('Email/Password sign-in is not enabled. Please enable it in the Firebase Console under Authentication > Sign-in method.');
      } else {
        setAuthError(err.message);
      }
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const sendFriendRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!friendCodeInput.trim() || !user || !profile) return;

    if (friendCodeInput.toUpperCase() === profile.friendCode) {
      setError("You can't add yourself!");
      return;
    }

    try {
      // Find user by friend code
      const q = query(collection(db, 'users'), where('friendCode', '==', friendCodeInput.toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setError('Friend code not found.');
        return;
      }

      const targetUser = querySnapshot.docs[0].data() as UserProfile;

      // Check if already friends
      if (friends.some(f => f.uid === targetUser.uid)) {
        setError('Already friends with this user.');
        return;
      }

      // Send request
      await addDoc(collection(db, 'friendRequests'), {
        fromUid: user.uid,
        fromName: profile.displayName,
        fromPhoto: profile.photoURL,
        toUid: targetUser.uid,
        status: 'pending',
        createdAt: Date.now()
      });

      setSuccess('Friend request sent!');
      setFriendCodeInput('');
    } catch (err) {
      console.error(err);
      setError('Failed to send request.');
    }
  };

  const acceptRequest = async (req: FriendRequest) => {
    try {
      await addDoc(collection(db, 'friendships'), {
        user1: req.fromUid,
        user2: req.toUid,
        createdAt: Date.now()
      });
      await deleteDoc(doc(db, 'friendRequests', req.id));
    } catch (err) {
      console.error(err);
    }
  };

  const declineRequest = async (reqId: string) => {
    try {
      await deleteDoc(doc(db, 'friendRequests', reqId));
    } catch (err) {
      console.error(err);
    }
  };

  const copyFriendCode = () => {
    if (profile?.friendCode) {
      navigator.clipboard.writeText(profile.friendCode);
      setSuccess('Friend code copied!');
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  const handleProfilePicChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const currentUser = auth.currentUser;
    if (!file || !currentUser) return;

    setUploading(true);
    setError('');
    
    try {
      const storageRef = ref(storage, `profile_pics/${currentUser.uid}`);
      await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(storageRef);
      
      // Update Auth profile
      await updateProfile(currentUser, { photoURL: downloadURL });
      
      // Update Firestore profile
      const userRef = doc(db, 'users', currentUser.uid);
      await setDoc(userRef, { photoURL: downloadURL }, { merge: true });
      
      setSuccess('Profile picture updated!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Failed to upload profile picture', err);
      setError('Failed to update profile picture.');
    } finally {
      setUploading(false);
    }
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (!user || !activeChat) return;

    setDoc(doc(db, 'users', user.uid), { typingTo: activeChat.uid }, { merge: true }).catch(console.error);

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setDoc(doc(db, 'users', user.uid), { typingTo: '' }, { merge: true }).catch(console.error);
    }, 2000);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user || !activeChat) return;

    try {
      await addDoc(collection(db, 'messages'), {
        senderId: user.uid,
        receiverId: activeChat.uid,
        text: newMessage.trim(),
        createdAt: Date.now()
      });
      setNewMessage('');
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      setDoc(doc(db, 'users', user.uid), { typingTo: '' }, { merge: true }).catch(console.error);
    } catch (err) {
      console.error('Failed to send message', err);
    }
  };

  return (
    <div className="absolute inset-0 bg-[#22272e]/95 backdrop-blur-md z-50 flex flex-col p-6 overflow-hidden">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-bold text-white flex items-center gap-2">
          <Users size={24} /> Friends
        </h3>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors outline-none">
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-gray-400" size={32} />
          </div>
        ) : !user ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <Users size={48} className="text-[#444c56]" />
            <p className="text-gray-400 mb-4">Sign in to add friends and see what they're listening to.</p>
            
            {authError && <p className="text-red-400 text-sm max-w-xs">{authError}</p>}

            {authMode === 'select' && (
              <div className="flex flex-col gap-3 w-full max-w-xs">
                <button 
                  onClick={handleLogin}
                  className="bg-white text-black px-6 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                >
                  <LogIn size={20} /> Continue with Google
                </button>
                <div className="relative flex items-center py-2">
                  <div className="flex-grow border-t border-[#444c56]"></div>
                  <span className="flex-shrink-0 mx-4 text-[#8b949e] text-sm">or</span>
                  <div className="flex-grow border-t border-[#444c56]"></div>
                </div>
                <button 
                  onClick={() => setAuthMode('signup')}
                  className="bg-[#2d333b] text-white px-6 py-2.5 rounded-lg font-medium hover:bg-[#444c56] transition-colors border border-[#444c56]"
                >
                  Create Account
                </button>
                <button 
                  onClick={() => setAuthMode('login')}
                  className="text-[#8b949e] hover:text-white transition-colors text-sm mt-2"
                >
                  Already have an account? Sign In
                </button>
              </div>
            )}

            {authMode === 'signup' && (
              <form onSubmit={handleEmailSignUp} className="flex flex-col gap-3 w-full max-w-xs">
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-[#1c2128] text-white px-4 py-2.5 rounded-lg outline-none focus:ring-2 focus:ring-white/20 border border-[#444c56]"
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-[#1c2128] text-white px-4 py-2.5 rounded-lg outline-none focus:ring-2 focus:ring-white/20 border border-[#444c56]"
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[#1c2128] text-white px-4 py-2.5 rounded-lg outline-none focus:ring-2 focus:ring-white/20 border border-[#444c56]"
                  required
                  minLength={6}
                />
                <button type="submit" className="bg-white text-black px-6 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors mt-2">
                  Sign Up
                </button>
                <button 
                  type="button"
                  onClick={() => setAuthMode('select')}
                  className="text-[#8b949e] hover:text-white transition-colors text-sm mt-2"
                >
                  Back
                </button>
              </form>
            )}

            {authMode === 'login' && (
              <form onSubmit={handleEmailLogin} className="flex flex-col gap-3 w-full max-w-xs">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-[#1c2128] text-white px-4 py-2.5 rounded-lg outline-none focus:ring-2 focus:ring-white/20 border border-[#444c56]"
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[#1c2128] text-white px-4 py-2.5 rounded-lg outline-none focus:ring-2 focus:ring-white/20 border border-[#444c56]"
                  required
                />
                <button type="submit" className="bg-white text-black px-6 py-2.5 rounded-lg font-medium hover:bg-gray-200 transition-colors mt-2">
                  Sign In
                </button>
                <button 
                  type="button"
                  onClick={() => setAuthMode('select')}
                  className="text-[#8b949e] hover:text-white transition-colors text-sm mt-2"
                >
                  Back
                </button>
              </form>
            )}
          </div>
        ) : (
          <>
            {/* Profile & Friend Code */}
            <div className="bg-[#2d333b] p-4 rounded-xl flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative group cursor-pointer">
                  {profile?.photoURL ? (
                    <img 
                      key={profile.photoURL}
                      src={profile.photoURL} 
                      alt="Profile" 
                      className="w-12 h-12 rounded-full object-cover border-2 border-transparent group-hover:border-white/20 transition-all" 
                      referrerPolicy="no-referrer" 
                    />
                  ) : (
                    <div className="w-12 h-12 bg-[#444c56] rounded-full flex items-center justify-center border-2 border-transparent group-hover:border-white/20 transition-all">
                      <Users size={24} />
                    </div>
                  )}
                  <label className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    {uploading ? <Loader2 className="animate-spin text-white" size={16} /> : <Camera size={16} className="text-white" />}
                    <input type="file" className="hidden" accept="image/*" onChange={handleProfilePicChange} disabled={uploading} />
                  </label>
                </div>
                <div>
                  <p className="text-white font-medium">{profile?.displayName}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    Code: <span className="font-mono text-white tracking-wider">{profile?.friendCode}</span>
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={copyFriendCode} className="p-2 bg-[#444c56] hover:bg-[#535c68] rounded-lg transition-colors" title="Copy Code">
                  <Copy size={16} />
                </button>
                <button onClick={handleLogout} className="p-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors" title="Sign Out">
                  <LogOut size={16} />
                </button>
              </div>
            </div>

            {/* Add Friend */}
            <div className="bg-[#2d333b] p-4 rounded-xl">
              <h4 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Add Friend</h4>
              <form onSubmit={sendFriendRequest} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter Friend Code"
                  value={friendCodeInput}
                  onChange={(e) => setFriendCodeInput(e.target.value)}
                  className="flex-1 bg-[#1c2128] text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-white/20 font-mono uppercase"
                  maxLength={8}
                />
                <button type="submit" className="bg-white text-black px-4 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors flex items-center gap-2">
                  <UserPlus size={18} /> Add
                </button>
              </form>
              {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
              {success && <p className="text-green-400 text-sm mt-2">{success}</p>}
            </div>

            {/* Friend Requests */}
            {requests.length > 0 && (
              <div className="bg-[#2d333b] p-4 rounded-xl">
                <h4 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Friend Requests</h4>
                <div className="flex flex-col gap-3">
                  {requests.map(req => (
                    <div key={req.id} className="flex items-center justify-between bg-[#1c2128] p-3 rounded-lg">
                      <div className="flex items-center gap-3">
                        {req.fromPhoto ? (
                          <img src={req.fromPhoto} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-8 h-8 bg-[#444c56] rounded-full" />
                        )}
                        <span className="text-white font-medium">{req.fromName}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => acceptRequest(req)} className="p-1.5 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-md transition-colors">
                          <Check size={18} />
                        </button>
                        <button onClick={() => declineRequest(req.id)} className="p-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-md transition-colors">
                          <X size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Friends List */}
            <div className="bg-[#2d333b] p-4 rounded-xl flex-1 flex flex-col min-h-0">
              {activeChat ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-[#444c56]">
                    <button onClick={() => setActiveChat(null)} className="p-1 hover:bg-[#444c56] rounded-md transition-colors text-gray-400 hover:text-white">
                      <ArrowLeft size={20} />
                    </button>
                    {activeChat.photoURL ? (
                      <img src={activeChat.photoURL} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <div className="w-8 h-8 bg-[#444c56] rounded-full flex items-center justify-center">
                        <Users size={14} />
                      </div>
                    )}
                    <span className="text-white font-medium">{activeChat.displayName}</span>
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 mb-4 pr-2">
                    {messages.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center my-auto">Say hi to {activeChat.displayName}!</p>
                    ) : (
                      messages.map(msg => {
                        const isMe = msg.senderId === user.uid;
                        return (
                          <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-[#1c2128] text-gray-200 rounded-tl-sm'}`}>
                              <p className="text-sm break-words">{msg.text}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    {activeChat.typingTo === user.uid && (
                      <div className="flex justify-start">
                        <div className="bg-[#1c2128] text-gray-400 rounded-2xl px-4 py-2 rounded-tl-sm text-sm italic">
                          typing...
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <form onSubmit={sendMessage} className="flex gap-2 mt-auto">
                    <input
                      type="text"
                      value={newMessage}
                      onChange={handleTyping}
                      placeholder="Message..."
                      className="flex-1 bg-[#1c2128] text-white px-4 py-2 rounded-full outline-none focus:ring-2 focus:ring-white/20 text-sm"
                    />
                    <button 
                      type="submit" 
                      disabled={!newMessage.trim()}
                      className="bg-blue-600 text-white px-4 py-2 rounded-full font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Send
                    </button>
                  </form>
                </div>
              ) : (
                <>
                  <h4 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Your Friends</h4>
                  <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                    {friends.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center py-4">No friends yet. Add someone using their code!</p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {friends.map(friend => (
                          <div 
                            key={friend.uid} 
                            onClick={() => setActiveChat(friend)}
                            className="flex items-center gap-3 bg-[#1c2128] p-3 rounded-lg cursor-pointer hover:bg-[#30363d] transition-colors"
                          >
                            <div className="relative">
                              {friend.photoURL ? (
                                <img src={friend.photoURL} alt="" className="w-10 h-10 rounded-full" referrerPolicy="no-referrer" />
                              ) : (
                                <div className="w-10 h-10 bg-[#444c56] rounded-full flex items-center justify-center">
                                  <Users size={16} />
                                </div>
                              )}
                              {friend.currentSong && (
                                <div className="absolute -bottom-1 -right-1 bg-green-500 w-3.5 h-3.5 rounded-full border-2 border-[#1c2128]" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-medium truncate">{friend.displayName}</p>
                              {friend.typingTo === user.uid ? (
                                <p className="text-xs text-blue-400 italic truncate">Typing...</p>
                              ) : friend.currentSong ? (
                                <p className="text-xs text-green-400 truncate flex items-center gap-1">
                                  <Music size={10} /> {friend.currentSong.title} - {friend.currentSong.artist}
                                </p>
                              ) : (
                                <p className="text-xs text-gray-500">Offline</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
