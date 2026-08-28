import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, UserPlus, Check, X, Copy, LogIn, LogOut, Loader2, Music, ArrowLeft, 
  Camera, Phone, Video, PhoneOff, Mic, MicOff, VideoOff, Plus, Shield, 
  AlertTriangle, Clock, Ban, Search, Image as ImageIcon, Sparkles, 
  UploadCloud, Volume2, Info, ChevronDown, ChevronUp, RefreshCw 
} from 'lucide-react';
import { auth, db, storage } from './firebase';
import { 
  signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User, 
  createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile 
} from 'firebase/auth';
import { 
  collection, query, where, onSnapshot, setDoc, doc, getDocs, deleteDoc, 
  addDoc, updateDoc, orderBy, limit 
} from 'firebase/firestore';
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
  role?: 'user' | 'admin';
  isBanned?: boolean;
  timeoutUntil?: number;
  warnings?: { text: string; createdAt: number }[];
  createdAt?: number;
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
  conversationId: string;
  text: string;
  createdAt: number;
  read?: boolean;
}

interface Call {
  id: string;
  callerId: string;
  receiverId: string;
  offer?: any;
  answer?: any;
  status: 'ringing' | 'ongoing' | 'ended';
  type: 'voice' | 'video';
  createdAt: number;
}

interface CallCandidate {
  id: string;
  callId: string;
  senderId: string;
  candidate: any;
  createdAt: number;
}

interface Group {
  id: string;
  name: string;
  ownerId: string;
  members: string[];
  createdAt: number;
}

interface GroupMessage {
  id: string;
  groupId: string;
  senderId: string;
  senderName: string;
  senderPhoto: string;
  senderRole?: 'user' | 'admin';
  text: string;
  createdAt: number;
}

const PRESET_AVATARS = [
  'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1522075469751-3a6694fb2f61?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1501196354995-cbb51c65aaea?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&h=200&fit=crop&crop=face',
  'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop&crop=face',
];

// Helper to compress and resize image directly on client canvas
const compressAndResizeImage = (file: File, maxSize = 300, quality = 0.85): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return resolve(event.target?.result as string);
        }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(new Error('Failed to load image file into canvas.'));
    };
    reader.onerror = (err) => reject(new Error('Failed to read file from disk.'));
  });
};

export default function FriendsMenu({ onClose }: { onClose: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState('');
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  
  // Avatar manager modal state
  const [showAvatarModal, setShowAvatarModal] = useState(false);
  const [customAvatarUrl, setCustomAvatarUrl] = useState('');
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(null);

  // Chat states
  const [activeChat, setActiveChat] = useState<UserProfile | null>(null);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<(Message | GroupMessage)[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Group creation states
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [viewingProfile, setViewingProfile] = useState<UserProfile | null>(null);

  // Call states
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [callStream, setCallStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callConnecting, setCallConnecting] = useState(false);
  
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const callDurationTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Admin states
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState<'all' | 'banned' | 'timedout' | 'admins'>('all');
  
  // Admin action modals (no native prompt/confirm)
  const [warnModalUser, setWarnModalUser] = useState<UserProfile | null>(null);
  const [warningMessage, setWarningMessage] = useState('');
  const [timeoutModalUser, setTimeoutModalUser] = useState<UserProfile | null>(null);
  const [timeoutMinutes, setTimeoutMinutes] = useState<number>(15);
  const [banModalUser, setBanModalUser] = useState<UserProfile | null>(null);

  // Auth states
  const [authMode, setAuthMode] = useState<'select' | 'login' | 'signup'>('select');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [authError, setAuthError] = useState('');

  const isAdminUser = profile?.role === 'admin' || 
    user?.email === 'awdrej.puente@icloud.com' || 
    user?.email === 'awdrepuente408@gmail.com';

  useEffect(() => {
    let unsubscribeProfile: (() => void) | null = null;
    let unsubscribeRequests: (() => void) | null = null;
    let unsubF1: (() => void) | null = null;
    let unsubF2: (() => void) | null = null;
    let unsubFriends: (() => void) | null = null;
    let unsubGroups: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeRequests) unsubscribeRequests();
      if (unsubF1) unsubF1();
      if (unsubF2) unsubF2();
      if (unsubFriends) unsubFriends();
      if (unsubGroups) unsubGroups();

      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        unsubscribeProfile = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);
            
            const isOwnerEmail = currentUser.email === 'awdrej.puente@icloud.com' || currentUser.email === 'awdrepuente408@gmail.com';
            if (isOwnerEmail && data.role !== 'admin') {
              updateDoc(userRef, { role: 'admin' }).catch(console.error);
            }
          } else {
            const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
            const isOwnerEmail = currentUser.email === 'awdrej.puente@icloud.com' || currentUser.email === 'awdrepuente408@gmail.com';
            const newProfile = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || 'Anonymous',
              photoURL: currentUser.photoURL || '',
              friendCode: newCode,
              role: isOwnerEmail ? 'admin' : 'user',
              createdAt: Date.now()
            };
            setDoc(userRef, newProfile).catch(console.error);
          }
        }, (error) => handleFirestoreError(error, OperationType.GET, `users/${currentUser.uid}`));

        const qRequests = query(collection(db, 'friendRequests'), where('toUid', '==', currentUser.uid));
        unsubscribeRequests = onSnapshot(qRequests, (snapshot) => {
          const reqs: FriendRequest[] = [];
          snapshot.forEach(d => reqs.push({ id: d.id, ...d.data() } as FriendRequest));
          setRequests(reqs);
        }, (error) => handleFirestoreError(error, OperationType.LIST, 'friendRequests'));

        const qGroups = query(collection(db, 'groups'), where('members', 'array-contains', currentUser.uid));
        unsubGroups = onSnapshot(qGroups, (snapshot) => {
          const gList: Group[] = [];
          snapshot.forEach(d => gList.push({ id: d.id, ...d.data() } as Group));
          setGroups(gList);
        }, (error) => handleFirestoreError(error, OperationType.LIST, 'groups'));

        const qFriendships1 = query(collection(db, 'friendships'), where('user1', '==', currentUser.uid));
        const qFriendships2 = query(collection(db, 'friendships'), where('user2', '==', currentUser.uid));
        
        const handleFriendships = async (snapshot1: any, snapshot2: any) => {
          const friendUids = new Set<string>();
          snapshot1?.forEach((d: any) => friendUids.add(d.data().user2));
          snapshot2?.forEach((d: any) => friendUids.add(d.data().user1));
          
          if (unsubFriends) {
            unsubFriends();
            unsubFriends = null;
          }

          if (friendUids.size > 0) {
            const qFriends = query(collection(db, 'users'), where('uid', 'in', Array.from(friendUids)));
            unsubFriends = onSnapshot(qFriends, (friendsSnap) => {
              const fList: UserProfile[] = [];
              friendsSnap.forEach(d => fList.push(d.data() as UserProfile));
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
      if (unsubGroups) unsubGroups();
    };
  }, []);

  // Fetch all users for Admin Panel
  useEffect(() => {
    if (!showAdminPanel || !isAdminUser) return;
    setLoadingUsers(true);
    const q = query(collection(db, 'users'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const uList: UserProfile[] = [];
      snapshot.forEach(d => uList.push(d.data() as UserProfile));
      setAllUsers(uList);
      setLoadingUsers(false);
    }, (err) => {
      console.error('Failed to load all users for admin:', err);
      setLoadingUsers(false);
    });
    return () => unsubscribe();
  }, [showAdminPanel, isAdminUser]);

  // Listen to messages
  useEffect(() => {
    if (!user) {
      setMessages([]);
      return;
    }

    if (activeChat) {
      const convId = [user.uid, activeChat.uid].sort().join('_');
      const q = query(
        collection(db, 'messages'),
        where('conversationId', '==', convId),
        orderBy('createdAt', 'asc')
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const msgs: Message[] = [];
        snapshot.forEach(d => msgs.push({ id: d.id, ...d.data() } as Message));
        setMessages(msgs);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'messages'));

      return () => unsub();
    } else if (activeGroup) {
      const q = query(
        collection(db, 'groupMessages'),
        where('groupId', '==', activeGroup.id),
        orderBy('createdAt', 'asc')
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const msgs: GroupMessage[] = [];
        snapshot.forEach(d => msgs.push({ id: d.id, ...d.data() } as GroupMessage));
        setMessages(msgs);
        setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'groupMessages'));

      return () => unsub();
    } else {
      setMessages([]);
    }
  }, [user, activeChat, activeGroup]);

  // Mark unread messages as read
  useEffect(() => {
    if (user && activeChat && messages.length > 0) {
      const markAsRead = async () => {
        const unreadMsgs = messages.filter(
          m => 'receiverId' in m && m.receiverId === user.uid && !m.read
        );
        for (const msg of unreadMsgs) {
          try {
            await updateDoc(doc(db, 'messages', msg.id), { read: true });
          } catch (err) {
            console.warn('Failed to mark message as read:', err);
          }
        }
      };
      markAsRead();
    }
  }, [messages, activeChat, user]);

  // Listen for incoming calls
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'calls'),
      where('receiverId', '==', user.uid),
      where('status', '==', 'ringing')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        const callData = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as Call;
        if (!activeCall && !incomingCall) {
          setIncomingCall(callData);
        }
      } else {
        setIncomingCall(null);
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'calls'));

    return () => unsubscribe();
  }, [user, activeCall, incomingCall]);

  // Listen for active call state updates
  useEffect(() => {
    if (!activeCall || !user) return;

    const unsubscribe = onSnapshot(doc(db, 'calls', activeCall.id), async (snapshot) => {
      if (!snapshot.exists()) {
        endCallLocally();
        return;
      }

      const data = snapshot.data() as Call;
      if (data.status === 'ended') {
        endCallLocally();
      } else if (data.status === 'ongoing' && data.answer && pcRef.current) {
        if (!pcRef.current.remoteDescription || !pcRef.current.remoteDescription.type) {
          try {
            const remoteDesc = new RTCSessionDescription(data.answer);
            await pcRef.current.setRemoteDescription(remoteDesc);
            await drainPendingCandidates();
            setActiveCall(prev => prev ? { ...prev, status: 'ongoing' } : null);
            setCallConnecting(false);
          } catch (e) {
            console.error('Failed to set remote answer:', e);
          }
        }
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `calls/${activeCall.id}`));

    return () => unsubscribe();
  }, [activeCall?.id, user]);

  // Listen for ICE candidates
  useEffect(() => {
    if (!activeCall || !user) return;

    const candidatesRef = collection(db, 'calls', activeCall.id, 'candidates');
    const unsubscribe = onSnapshot(candidatesRef, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as CallCandidate;
          if (data.senderId !== user.uid && data.candidate) {
            addIceCandidateSafe(data.candidate);
          }
        }
      });
    }, (error) => {
      console.warn('Candidate listener warning:', error);
    });

    return () => unsubscribe();
  }, [activeCall?.id, user]);

  // Call duration counter
  useEffect(() => {
    if (activeCall?.status === 'ongoing') {
      setCallDuration(0);
      callDurationTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      if (callDurationTimerRef.current) {
        clearInterval(callDurationTimerRef.current);
        callDurationTimerRef.current = null;
      }
      setCallDuration(0);
    }
    return () => {
      if (callDurationTimerRef.current) {
        clearInterval(callDurationTimerRef.current);
      }
    };
  }, [activeCall?.status]);

  const addIceCandidateSafe = async (candidateData: any) => {
    if (!pcRef.current) return;
    const candidate = new RTCIceCandidate(candidateData);
    if (pcRef.current.remoteDescription && pcRef.current.remoteDescription.type) {
      try {
        await pcRef.current.addIceCandidate(candidate);
      } catch (e) {
        console.warn('Failed to add candidate:', e);
      }
    } else {
      pendingCandidatesRef.current.push(candidateData);
    }
  };

  const drainPendingCandidates = async () => {
    if (!pcRef.current || !pcRef.current.remoteDescription) return;
    while (pendingCandidatesRef.current.length > 0) {
      const cand = pendingCandidatesRef.current.shift();
      if (cand) {
        try {
          await pcRef.current.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Error draining candidate:', e);
        }
      }
    }
  };

  const setupPeerConnection = (callId: string) => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    pendingCandidatesRef.current = [];

    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && user) {
        addDoc(collection(db, 'calls', callId, 'candidates'), {
          callId,
          senderId: user.uid,
          candidate: event.candidate.toJSON(),
          createdAt: Date.now()
        }).catch(err => console.warn('Failed to send ICE candidate:', err));
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setRemoteStream(stream);
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = stream;
        remoteAudioRef.current.play().catch(e => console.log('Audio autoplay info:', e));
      }
      setCallConnecting(false);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected') {
        setCallConnecting(false);
      }
    };

    pcRef.current = pc;
    return pc;
  };

  const startCall = async (type: 'voice' | 'video') => {
    if (!user || !activeChat) return;

    try {
      setError('');
      setErrorDetails('');
      setCallConnecting(true);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: type === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false
        });
      } catch (mediaErr: any) {
        console.error('Media devices error:', mediaErr);
        setError(`Microphone/Camera permission required: ${mediaErr?.message || 'Access denied'}`);
        setErrorDetails(String(mediaErr?.stack || mediaErr));
        setCallConnecting(false);
        return;
      }

      setCallStream(stream);

      const callDocRef = await addDoc(collection(db, 'calls'), {
        callerId: user.uid,
        receiverId: activeChat.uid,
        status: 'ringing',
        type,
        createdAt: Date.now()
      });

      const pc = setupPeerConnection(callDocRef.id);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video'
      });
      await pc.setLocalDescription(offer);

      await updateDoc(callDocRef, {
        offer: { type: offer.type, sdp: offer.sdp }
      });

      setActiveCall({
        id: callDocRef.id,
        callerId: user.uid,
        receiverId: activeChat.uid,
        status: 'ringing',
        type,
        createdAt: Date.now()
      });
    } catch (err: any) {
      console.error('Failed to start call', err);
      setError(`Failed to start call: ${err?.message || err}`);
      setErrorDetails(String(err?.stack || JSON.stringify(err)));
      setCallConnecting(false);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || !user) return;

    try {
      setError('');
      setErrorDetails('');
      setCallConnecting(true);

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: incomingCall.type === 'video' ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false
        });
      } catch (mediaErr: any) {
        console.error('Media access error on accept:', mediaErr);
        setError(`Microphone/Camera permission required: ${mediaErr?.message || 'Access denied'}`);
        setErrorDetails(String(mediaErr?.stack || mediaErr));
        setCallConnecting(false);
        return;
      }

      setCallStream(stream);

      const pc = setupPeerConnection(incomingCall.id);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      if (incomingCall.offer) {
        const offer = new RTCSessionDescription(incomingCall.offer);
        await pc.setRemoteDescription(offer);
        await drainPendingCandidates();
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, 'calls', incomingCall.id), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: 'ongoing'
      });

      setActiveCall({ ...incomingCall, status: 'ongoing' });
      setIncomingCall(null);
      setCallConnecting(false);
    } catch (err: any) {
      console.error('Failed to accept call', err);
      setError(`Failed to accept call: ${err?.message || err}`);
      setErrorDetails(String(err?.stack || JSON.stringify(err)));
      setCallConnecting(false);
    }
  };

  const endCall = async () => {
    if (activeCall) {
      try {
        await updateDoc(doc(db, 'calls', activeCall.id), { status: 'ended' });
      } catch (err) {
        console.warn('Failed to update call status to ended:', err);
      }
    }
    endCallLocally();
  };

  const endCallLocally = () => {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (callStream) {
      callStream.getTracks().forEach(track => track.stop());
      setCallStream(null);
    }
    setRemoteStream(null);
    setActiveCall(null);
    setIncomingCall(null);
    setIsMicMuted(false);
    setIsVideoOff(false);
    setCallConnecting(false);
    setCallDuration(0);
    if (callDurationTimerRef.current) {
      clearInterval(callDurationTimerRef.current);
      callDurationTimerRef.current = null;
    }
  };

  const toggleMic = () => {
    if (callStream) {
      const audioTrack = callStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (callStream) {
      const videoTrack = callStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Robust Profile Picture Update Handler
  const applyProfilePhoto = async (finalPhotoUrl: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser || !finalPhotoUrl) return;

    setUploading(true);
    setError('');
    setErrorDetails('');

    try {
      // 1. Update Firebase Auth profile
      await updateProfile(currentUser, { photoURL: finalPhotoUrl });

      // 2. Update Firestore user document
      const userRef = doc(db, 'users', currentUser.uid);
      await setDoc(userRef, { photoURL: finalPhotoUrl }, { merge: true });

      // 3. Optimistic local state update
      setProfile(prev => prev ? { ...prev, photoURL: finalPhotoUrl } : null);
      
      setSuccess('Profile picture updated successfully!');
      setShowAvatarModal(false);
      setPreviewAvatar(null);
      setCustomAvatarUrl('');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err: any) {
      console.error('Failed to apply profile photo:', err);
      setError(`Failed to save photo: ${err?.message || 'Database permission error'}`);
      setErrorDetails(String(err?.stack || JSON.stringify(err, Object.getOwnPropertyNames(err), 2)));
    } finally {
      setUploading(false);
    }
  };

  const handleProfileFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const currentUser = auth.currentUser;
    if (!file || !currentUser) return;

    setUploading(true);
    setError('');
    setErrorDetails('');

    try {
      // Step 1: Compress image on client canvas for high quality + tiny payload (<30KB)
      const compressedDataUrl = await compressAndResizeImage(file, 300, 0.85);
      setPreviewAvatar(compressedDataUrl);

      // Step 2: Try Firebase Storage upload first
      let resolvedUrl = compressedDataUrl;
      try {
        const storageRef = ref(storage, `profile_pics/${currentUser.uid}_${Date.now()}.jpg`);
        await uploadBytes(storageRef, file);
        resolvedUrl = await getDownloadURL(storageRef);
      } catch (storageErr: any) {
        console.warn('Storage upload unavailable or blocked, falling back to instant compressed image data URL:', storageErr);
        // Seamless fallback to the high quality data URL!
        resolvedUrl = compressedDataUrl;
      }

      // Step 3: Apply the photo
      await applyProfilePhoto(resolvedUrl);
    } catch (err: any) {
      console.error('Error handling profile image file:', err);
      setError(`Image processing error: ${err?.message || 'Could not read file'}`);
      setErrorDetails(String(err?.stack || JSON.stringify(err, Object.getOwnPropertyNames(err), 2)));
      setUploading(false);
    }
  };

  // Fast Admin Actions (No slow native browser prompts/confirms)
  const handleSendWarning = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warnModalUser || !warningMessage.trim() || !isAdminUser) return;

    try {
      const userRef = doc(db, 'users', warnModalUser.uid);
      const newWarning = { text: warningMessage.trim(), createdAt: Date.now() };
      await updateDoc(userRef, {
        warnings: [...(warnModalUser.warnings || []), newWarning]
      });
      setSuccess(`Warning sent to ${warnModalUser.displayName}!`);
      setWarnModalUser(null);
      setWarningMessage('');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(`Failed to warn user: ${err?.message}`);
      setErrorDetails(String(err?.stack || err));
    }
  };

  const handleApplyTimeout = async (userToTimeout: UserProfile, minutes: number) => {
    if (!isAdminUser) return;
    try {
      const userRef = doc(db, 'users', userToTimeout.uid);
      const timeoutUntil = minutes > 0 ? Date.now() + minutes * 60000 : 0;
      await updateDoc(userRef, { timeoutUntil });
      setSuccess(minutes > 0 ? `Timed out ${userToTimeout.displayName} for ${minutes}m!` : `Cleared timeout for ${userToTimeout.displayName}!`);
      setTimeoutModalUser(null);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(`Failed to timeout user: ${err?.message}`);
      setErrorDetails(String(err?.stack || err));
    }
  };

  const handleToggleBan = async (userToBan: UserProfile) => {
    if (!isAdminUser) return;
    const newStatus = !userToBan.isBanned;
    try {
      const userRef = doc(db, 'users', userToBan.uid);
      await updateDoc(userRef, { isBanned: newStatus });
      setSuccess(`${newStatus ? 'Banned' : 'Unbanned'} ${userToBan.displayName}!`);
      setBanModalUser(null);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(`Failed to toggle ban: ${err?.message}`);
      setErrorDetails(String(err?.stack || err));
    }
  };

  const handleToggleRole = async (targetUser: UserProfile) => {
    if (!isAdminUser) return;
    const newRole = targetUser.role === 'admin' ? 'user' : 'admin';
    try {
      const userRef = doc(db, 'users', targetUser.uid);
      await updateDoc(userRef, { role: newRole });
      setSuccess(`Updated ${targetUser.displayName}'s role to ${newRole}!`);
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      setError(`Failed to change role: ${err?.message}`);
      setErrorDetails(String(err?.stack || err));
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
    if (!newMessage.trim() || !user || (!activeChat && !activeGroup)) return;

    if (profile?.timeoutUntil && profile.timeoutUntil > Date.now()) {
      setError(`You are timed out until ${new Date(profile.timeoutUntil).toLocaleTimeString()}`);
      return;
    }

    try {
      if (activeChat) {
        const convId = [user.uid, activeChat.uid].sort().join('_');
        await addDoc(collection(db, 'messages'), {
          senderId: user.uid,
          receiverId: activeChat.uid,
          conversationId: convId,
          text: newMessage.trim(),
          createdAt: Date.now()
        });
      } else if (activeGroup) {
        await addDoc(collection(db, 'groupMessages'), {
          groupId: activeGroup.id,
          senderId: user.uid,
          senderName: profile?.displayName || 'Anonymous',
          senderPhoto: profile?.photoURL || '',
          senderRole: profile?.role || 'user',
          text: newMessage.trim(),
          createdAt: Date.now()
        });
      }
      setNewMessage('');
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (activeChat) {
        setDoc(doc(db, 'users', user.uid), { typingTo: '' }, { merge: true }).catch(console.error);
      }
    } catch (err: any) {
      console.error('Failed to send message', err);
      setError(err?.message || 'Failed to send message.');
    }
  };

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !groupName.trim() || selectedFriends.length < 1) return;

    try {
      await addDoc(collection(db, 'groups'), {
        name: groupName.trim(),
        ownerId: user.uid,
        members: [user.uid, ...selectedFriends],
        createdAt: Date.now()
      });
      setGroupName('');
      setSelectedFriends([]);
      setIsCreatingGroup(false);
      setSuccess('Group created!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err: any) {
      console.error('Failed to create group', err);
      setError('Failed to create group.');
    }
  };

  const toggleFriendSelection = (uid: string) => {
    setSelectedFriends(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const formatAuthError = (err: any): string => {
    const code = err?.code || '';
    switch (code) {
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
        return ''; // User intentionally closed/dismissed popup, don't show error
      case 'auth/popup-blocked':
        return 'The sign-in popup was blocked by your browser. Please allow popups or use Email sign-in below.';
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return 'Incorrect email or password. Please check your credentials.';
      case 'auth/email-already-in-use':
        return 'An account with this email already exists. Try signing in instead.';
      case 'auth/invalid-email':
        return 'Please enter a valid email address.';
      case 'auth/weak-password':
        return 'Password must be at least 6 characters long.';
      case 'auth/network-request-failed':
        return 'Network connection issue. Please check your internet connection.';
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a moment and try again.';
      default:
        return err?.message || 'Authentication failed. Please try again.';
    }
  };

  const handleLogin = async () => {
    try {
      setAuthError('');
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      const msg = formatAuthError(err);
      if (msg) {
        console.warn('Google sign-in error:', err);
        setAuthError(msg);
      }
    }
  };

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const cleanName = username.trim() || 'Anonymous';
      await updateProfile(userCredential.user, { displayName: cleanName });
      const userRef = doc(db, 'users', userCredential.user.uid);
      await setDoc(userRef, { displayName: cleanName }, { merge: true });
    } catch (err: any) {
      console.warn('Email sign up error:', err);
      setAuthError(formatAuthError(err) || 'Failed to create account.');
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: any) {
      console.warn('Email login error:', err);
      setAuthError(formatAuthError(err) || 'Failed to sign in.');
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
      const q = query(collection(db, 'users'), where('friendCode', '==', friendCodeInput.toUpperCase()));
      const querySnapshot = await getDocs(q);
      
      if (querySnapshot.empty) {
        setError('Friend code not found.');
        return;
      }

      const targetUser = querySnapshot.docs[0].data() as UserProfile;
      if (friends.some(f => f.uid === targetUser.uid)) {
        setError('Already friends with this user.');
        return;
      }

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
      setTimeout(() => setSuccess(''), 3000);
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
      setSuccess('Friend code copied to clipboard!');
      setTimeout(() => setSuccess(''), 3000);
    }
  };

  // Filtered users in admin list
  const filteredUsers = allUsers.filter(u => {
    const matchQuery = (u.displayName || '').toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                       (u.friendCode || '').toLowerCase().includes(userSearchQuery.toLowerCase()) ||
                       (u.uid || '').toLowerCase().includes(userSearchQuery.toLowerCase());
    if (!matchQuery) return false;
    if (userFilter === 'banned') return u.isBanned === true;
    if (userFilter === 'timedout') return u.timeoutUntil && u.timeoutUntil > Date.now();
    if (userFilter === 'admins') return u.role === 'admin';
    return true;
  });

  return (
    <div className="absolute inset-0 bg-[#22272e]/95 backdrop-blur-md z-50 flex flex-col p-6 overflow-hidden">
      {/* Hidden audio element for WebRTC voice playback */}
      <audio ref={remoteAudioRef} autoPlay playsInline controls={false} className="hidden" />

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Users size={24} /> Friends
          </h3>
          {isAdminUser && (
            <button
              onClick={() => setShowAdminPanel(true)}
              className="flex items-center gap-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-all shadow-md active:scale-95"
            >
              <Shield size={14} /> Admin Tools
            </button>
          )}
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-colors outline-none text-gray-400 hover:text-white">
          <X size={24} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar flex flex-col gap-6">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="animate-spin text-gray-400" size={32} />
          </div>
        ) : !user ? (
          /* Auth Screen */
          <div className="flex flex-col items-center justify-center h-full max-w-sm mx-auto text-center gap-6">
            <div className="w-16 h-16 bg-blue-600/20 rounded-full flex items-center justify-center text-blue-400">
              <Users size={32} />
            </div>
            <div>
              <h4 className="text-xl font-bold text-white mb-2">Connect with Friends</h4>
              <p className="text-gray-400 text-sm">
                Sign in to see what your friends are listening to, chat, voice call, and make group playlists!
              </p>
            </div>

            {authError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-lg w-full text-left">
                {authError}
              </div>
            )}

            {authMode === 'select' && (
              <div className="flex flex-col gap-3 w-full">
                <button
                  onClick={handleLogin}
                  className="bg-white text-black font-semibold py-3 px-4 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
                >
                  <LogIn size={20} /> Continue with Google
                </button>
                <div className="flex items-center gap-2 my-1">
                  <div className="h-[1px] bg-[#444c56] flex-1" />
                  <span className="text-xs text-gray-500 font-medium">OR</span>
                  <div className="h-[1px] bg-[#444c56] flex-1" />
                </div>
                <button
                  onClick={() => setAuthMode('login')}
                  className="bg-[#2d333b] hover:bg-[#373e47] text-white font-medium py-3 px-4 rounded-xl transition-colors border border-white/5"
                >
                  Sign in with Email
                </button>
                <button
                  onClick={() => setAuthMode('signup')}
                  className="text-xs text-blue-400 hover:underline mt-1"
                >
                  Don't have an account? Sign up
                </button>
              </div>
            )}

            {authMode === 'login' && (
              <form onSubmit={handleEmailLogin} className="flex flex-col gap-3 w-full">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-[#2d333b] text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[#2d333b] text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors mt-1"
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('select')}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Back to options
                </button>
              </form>
            )}

            {authMode === 'signup' && (
              <form onSubmit={handleEmailSignUp} className="flex flex-col gap-3 w-full">
                <input
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="bg-[#2d333b] text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-[#2d333b] text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-[#2d333b] text-white px-4 py-2.5 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  required
                />
                <button
                  type="submit"
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-xl transition-colors mt-1"
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => setAuthMode('select')}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Back to options
                </button>
              </form>
            )}
          </div>
        ) : (
          /* Logged In Screen */
          <>
            {/* Profile & Avatar Bar */}
            <div className="bg-[#2d333b] p-4 rounded-xl flex items-center justify-between shadow-md border border-white/5">
              <div className="flex items-center gap-3">
                <div 
                  onClick={() => setShowAvatarModal(true)}
                  className="relative group cursor-pointer"
                  title="Click to change profile picture"
                >
                  {profile?.photoURL ? (
                    <img 
                      src={profile.photoURL} 
                      alt="" 
                      className="w-12 h-12 rounded-full object-cover border-2 border-white/10 group-hover:border-blue-500 transition-colors" 
                      referrerPolicy="no-referrer" 
                    />
                  ) : (
                    <div className="w-12 h-12 bg-[#444c56] rounded-full flex items-center justify-center text-gray-300 group-hover:bg-[#535c68]">
                      <Users size={20} />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <Camera size={16} className="text-white" />
                  </div>
                  {uploading && (
                    <div className="absolute inset-0 bg-black/70 rounded-full flex items-center justify-center">
                      <Loader2 className="animate-spin text-white" size={16} />
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-white font-bold">{profile?.displayName}</p>
                    {profile?.role === 'admin' && (
                      <span className="text-[9px] bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">
                        Owner
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400">
                    Code: <span className="font-mono text-blue-400 font-bold tracking-wider">{profile?.friendCode}</span>
                  </p>
                  
                  <div className="flex gap-2 mt-1.5">
                    <button
                      onClick={() => setShowAvatarModal(true)}
                      className="text-[11px] bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1"
                    >
                      <Camera size={11} /> Change Photo
                    </button>
                    {isAdminUser && (
                      <button
                        onClick={() => setShowAdminPanel(true)}
                        className="text-[11px] bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1"
                      >
                        <Shield size={11} /> Admin
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <button 
                  onClick={copyFriendCode} 
                  className="p-2.5 bg-[#444c56] hover:bg-[#535c68] text-gray-200 hover:text-white rounded-lg transition-colors" 
                  title="Copy Friend Code"
                >
                  <Copy size={16} />
                </button>
                <button 
                  onClick={handleLogout} 
                  className="p-2.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors" 
                  title="Sign Out"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>

            {/* Success & Error Banner */}
            {success && (
              <div className="bg-green-500/10 border border-green-500/30 text-green-400 text-sm p-3 rounded-xl flex items-center justify-between animate-in fade-in">
                <span>{success}</span>
                <button onClick={() => setSuccess('')} className="text-green-400 hover:text-white"><X size={16} /></button>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm p-3 rounded-xl flex flex-col gap-2 animate-in fade-in">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} />
                    <span className="font-semibold">{error}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {errorDetails && (
                      <button 
                        onClick={() => setShowErrorDetails(!showErrorDetails)}
                        className="text-xs bg-red-500/20 hover:bg-red-500/30 px-2 py-0.5 rounded text-red-300 transition-colors flex items-center gap-1"
                      >
                        {showErrorDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        {showErrorDetails ? 'Hide Details' : 'View Details'}
                      </button>
                    )}
                    <button onClick={() => setError('')} className="text-red-400 hover:text-white"><X size={16} /></button>
                  </div>
                </div>
                {showErrorDetails && errorDetails && (
                  <div className="bg-[#1c2128] p-3 rounded-lg border border-red-500/20 text-xs font-mono text-gray-300 overflow-x-auto">
                    <p className="text-[10px] text-gray-500 mb-1">TECHNICAL ERROR LOG:</p>
                    <pre className="whitespace-pre-wrap">{errorDetails}</pre>
                    <button 
                      onClick={() => {
                        navigator.clipboard.writeText(errorDetails);
                        setSuccess('Error details copied to clipboard!');
                      }}
                      className="mt-2 text-[10px] bg-[#2d333b] hover:bg-[#444c56] text-gray-300 px-2 py-1 rounded flex items-center gap-1"
                    >
                      <Copy size={10} /> Copy Error Details
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Add Friend & Create Group */}
            <div className="flex gap-4">
              <div className="bg-[#2d333b] p-4 rounded-xl flex-1 shadow-sm">
                <h4 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">Add Friend</h4>
                <form onSubmit={sendFriendRequest} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter 6-digit Code"
                    value={friendCodeInput}
                    onChange={(e) => setFriendCodeInput(e.target.value)}
                    className="flex-1 bg-[#1c2128] text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-mono uppercase text-sm"
                    maxLength={8}
                  />
                  <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors flex items-center gap-1.5 text-sm">
                    <UserPlus size={16} /> Add
                  </button>
                </form>
              </div>
              <div className="bg-[#2d333b] p-4 rounded-xl flex items-center justify-center shadow-sm">
                <button 
                  onClick={() => setIsCreatingGroup(true)}
                  className="w-11 h-11 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl flex items-center justify-center transition-colors shadow-md active:scale-95"
                  title="Create Group Chat"
                >
                  <Plus size={22} />
                </button>
              </div>
            </div>

            {/* Group Creator Modal */}
            {isCreatingGroup && (
              <div className="bg-[#2d333b] p-4 rounded-xl border border-indigo-500/30 shadow-lg">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                    <Users size={16} className="text-indigo-400" /> Create Group Chat
                  </h4>
                  <button onClick={() => setIsCreatingGroup(false)} className="text-gray-400 hover:text-white">
                    <X size={18} />
                  </button>
                </div>
                <form onSubmit={createGroup} className="flex flex-col gap-4">
                  <input
                    type="text"
                    placeholder="Group Name (e.g. Chill Beats Squad)"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="bg-[#1c2128] text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                    required
                  />
                  <div className="max-h-40 overflow-y-auto custom-scrollbar flex flex-col gap-2">
                    <p className="text-xs text-gray-400 mb-1">Select Members:</p>
                    {friends.length === 0 ? (
                      <p className="text-xs text-gray-500 italic py-2">Add friends first to include them in group chats!</p>
                    ) : (
                      friends.map(friend => (
                        <div 
                          key={friend.uid}
                          onClick={() => toggleFriendSelection(friend.uid)}
                          className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${selectedFriends.includes(friend.uid) ? 'bg-indigo-600/20 border border-indigo-500/50' : 'bg-[#1c2128] border border-transparent hover:border-white/10'}`}
                        >
                          {friend.photoURL ? (
                            <img src={friend.photoURL} alt="" className="w-6 h-6 rounded-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-6 h-6 bg-[#444c56] rounded-full flex items-center justify-center">
                              <Users size={12} />
                            </div>
                          )}
                          <span className="text-sm text-white flex-1">{friend.displayName}</span>
                          {selectedFriends.includes(friend.uid) && <Check size={14} className="text-indigo-400" />}
                        </div>
                      ))
                    )}
                  </div>
                  <button 
                    type="submit" 
                    disabled={!groupName.trim() || selectedFriends.length < 1}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 text-sm shadow-md"
                  >
                    Create Group Chat
                  </button>
                </form>
              </div>
            )}

            {/* Friend Requests */}
            {requests.length > 0 && (
              <div className="bg-[#2d333b] p-4 rounded-xl border border-blue-500/20">
                <h4 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                  <UserPlus size={14} className="text-blue-400" /> Friend Requests ({requests.length})
                </h4>
                <div className="flex flex-col gap-2">
                  {requests.map(req => (
                    <div key={req.id} className="flex items-center justify-between bg-[#1c2128] p-3 rounded-lg">
                      <div className="flex items-center gap-3">
                        {req.fromPhoto ? (
                          <img src={req.fromPhoto} alt="" className="w-8 h-8 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-8 h-8 bg-[#444c56] rounded-full flex items-center justify-center text-gray-400">
                            <Users size={14} />
                          </div>
                        )}
                        <span className="text-white font-medium text-sm">{req.fromName}</span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => acceptRequest(req)} className="p-1.5 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-md transition-colors" title="Accept">
                          <Check size={16} />
                        </button>
                        <button onClick={() => declineRequest(req.id)} className="p-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-md transition-colors" title="Decline">
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Friends & Groups List */}
            <div className="bg-[#2d333b] p-4 rounded-xl flex-1 flex flex-col min-h-0 shadow-sm">
              {(activeChat || activeGroup) ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#444c56]">
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setActiveChat(null); setActiveGroup(null); }} className="p-1 hover:bg-[#444c56] rounded-md transition-colors text-gray-400 hover:text-white">
                        <ArrowLeft size={20} />
                      </button>
                      {activeChat ? (
                        <div 
                          className="flex items-center gap-3 cursor-pointer hover:bg-[#444c56] p-1.5 rounded-lg transition-colors"
                          onClick={() => setViewingProfile(activeChat)}
                        >
                          {activeChat.photoURL ? (
                            <img src={activeChat.photoURL} alt="" className="w-9 h-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-9 h-9 bg-[#444c56] rounded-full flex items-center justify-center">
                              <Users size={16} />
                            </div>
                          )}
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                              <span className="text-white font-medium text-sm">{activeChat.displayName}</span>
                              {activeChat.role === 'admin' && (
                                <span className="text-[8px] bg-blue-500 text-white px-1 py-0.5 rounded font-bold uppercase tracking-wider">Owner</span>
                              )}
                            </div>
                            {activeChat.currentSong ? (
                              <span className="text-[10px] text-green-400 truncate max-w-[140px] flex items-center gap-1">
                                <Music size={10} /> {activeChat.currentSong.title}
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-400">Tap to view profile</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 bg-indigo-600/20 rounded-full flex items-center justify-center text-indigo-400">
                            <Users size={16} />
                          </div>
                          <span className="text-white font-medium">{activeGroup?.name}</span>
                        </div>
                      )}
                    </div>
                    
                    {activeChat && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => startCall('voice')}
                          className="p-2.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 rounded-full transition-all hover:scale-105"
                          title="Start Voice Call"
                        >
                          <Phone size={18} />
                        </button>
                        <button 
                          onClick={() => startCall('video')}
                          className="p-2.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 rounded-full transition-all hover:scale-105"
                          title="Start Video Call"
                        >
                          <Video size={18} />
                        </button>
                      </div>
                    )}
                  </div>
                  
                  {/* Messages Area */}
                  <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 mb-3 pr-2">
                    {messages.length === 0 ? (
                      <p className="text-gray-500 text-xs text-center my-auto">Start a conversation!</p>
                    ) : (
                      messages.map(msg => {
                        const isMe = msg.senderId === user.uid;
                        const gMsg = msg as GroupMessage;
                        return (
                          <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            {!isMe && activeGroup && (
                              <div className="flex items-center gap-1 mb-1 ml-1">
                                {gMsg.senderPhoto ? (
                                  <img src={gMsg.senderPhoto} alt="" className="w-4 h-4 rounded-full object-cover" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-4 h-4 bg-[#444c56] rounded-full" />
                                )}
                                <span className="text-[10px] text-gray-400">{gMsg.senderName}</span>
                                {gMsg.senderRole === 'admin' && (
                                  <span className="text-[8px] bg-blue-500 text-white px-1 py-0.5 rounded font-bold uppercase tracking-wider">Owner</span>
                                )}
                              </div>
                            )}
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-[#1c2128] text-gray-200 rounded-tl-sm'}`}>
                              <p className="text-sm break-words">{msg.text}</p>
                            </div>
                            {isMe && !activeGroup && (msg as Message).read && (
                              <span className="text-[10px] text-blue-400 mt-1 mr-1 flex items-center justify-end font-medium">Seen <Check size={10} className="ml-1" /></span>
                            )}
                          </div>
                        );
                      })
                    )}
                    {activeChat?.typingTo === user.uid && (
                      <div className="flex justify-start">
                        <div className="bg-[#1c2128] text-gray-400 rounded-2xl px-4 py-2 rounded-tl-sm text-xs italic animate-pulse">
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
                      onChange={activeChat ? handleTyping : (e) => setNewMessage(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1 bg-[#1c2128] text-white px-4 py-2.5 rounded-full outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                    <button 
                      type="submit" 
                      disabled={!newMessage.trim()}
                      className="bg-blue-600 text-white px-5 py-2.5 rounded-full font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                    >
                      Send
                    </button>
                  </form>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-6 flex-1 min-h-0">
                    {/* Groups Section */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                        <Users size={14} className="text-indigo-400" /> Group Chats
                      </h4>
                      <div className="flex flex-col gap-2">
                        {groups.length === 0 ? (
                          <p className="text-gray-500 text-xs italic py-1">No group chats yet. Click the + button above to create one!</p>
                        ) : (
                          groups.map(group => (
                            <div 
                              key={group.id}
                              onClick={() => { setActiveGroup(group); setActiveChat(null); }}
                              className="flex items-center gap-3 bg-[#1c2128] p-3 rounded-lg cursor-pointer hover:bg-[#30363d] transition-colors"
                            >
                              <div className="w-10 h-10 bg-indigo-600/20 rounded-full flex items-center justify-center text-indigo-400">
                                <Users size={18} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-medium text-sm truncate">{group.name}</p>
                                <p className="text-xs text-gray-500">{group.members.length} members</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Friends Section */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <h4 className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider flex items-center gap-2">
                        <Users size={14} className="text-blue-400" /> Friends ({friends.length})
                      </h4>
                      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                        {friends.length === 0 ? (
                          <p className="text-gray-500 text-xs text-center py-6">No friends added yet. Share your code or enter a friend's code!</p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {friends.map(friend => (
                              <div 
                                key={friend.uid} 
                                onClick={() => { setActiveChat(friend); setActiveGroup(null); }}
                                className="flex items-center gap-3 bg-[#1c2128] p-3 rounded-lg cursor-pointer hover:bg-[#30363d] transition-colors group"
                              >
                                <div className="relative">
                                  {friend.photoURL ? (
                                    <img src={friend.photoURL} alt="" className="w-10 h-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <div className="w-10 h-10 bg-[#444c56] rounded-full flex items-center justify-center text-gray-300">
                                      <Users size={16} />
                                    </div>
                                  )}
                                  {friend.currentSong && (
                                    <div className="absolute -bottom-1 -right-1 bg-green-500 w-3.5 h-3.5 rounded-full border-2 border-[#1c2128]" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className="text-white font-medium text-sm truncate">{friend.displayName}</p>
                                    {friend.role === 'admin' && (
                                      <span className="text-[8px] bg-blue-500 text-white px-1 py-0.5 rounded font-bold uppercase tracking-wider">Owner</span>
                                    )}
                                  </div>
                                  {friend.typingTo === user.uid ? (
                                    <p className="text-xs text-blue-400 italic truncate">Typing...</p>
                                  ) : friend.currentSong ? (
                                    <p className="text-xs text-green-400 truncate flex items-center gap-1">
                                      <Music size={10} /> {friend.currentSong.title} - {friend.currentSong.artist}
                                    </p>
                                  ) : (
                                    <p className="text-xs text-gray-500">Tap to chat or call</p>
                                  )}
                                </div>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveChat(friend);
                                      startCall('voice');
                                    }}
                                    className="p-1.5 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-full"
                                    title="Voice Call"
                                  >
                                    <Phone size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Incoming Call Overlay */}
      {incomingCall && (
        <div className="absolute top-6 left-6 right-6 bg-[#2d333b] border border-blue-500 rounded-2xl p-4 shadow-2xl z-[60] animate-in slide-in-from-top duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400 animate-pulse">
                {incomingCall.type === 'video' ? <Video size={24} /> : <Phone size={24} />}
              </div>
              <div>
                <p className="text-white font-bold text-base">Incoming {incomingCall.type} call</p>
                <p className="text-gray-400 text-sm">From {friends.find(f => f.uid === incomingCall.callerId)?.displayName || 'Friend'}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => updateDoc(doc(db, 'calls', incomingCall.id), { status: 'ended' })}
                className="p-3 bg-red-500 text-white hover:bg-red-600 rounded-full transition-colors shadow-lg"
                title="Decline"
              >
                <PhoneOff size={20} />
              </button>
              <button 
                onClick={acceptCall}
                className="p-3 bg-green-500 text-white hover:bg-green-600 rounded-full transition-colors shadow-lg animate-bounce"
                title="Accept"
              >
                <Phone size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call Fullscreen Overlay */}
      {activeCall && (
        <div className="absolute inset-0 bg-black/95 z-[70] flex flex-col items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="relative w-full max-w-2xl aspect-video bg-[#1c2128] rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col">
            
            {/* Top Call Info Bar */}
            <div className="absolute top-4 left-4 right-4 z-20 flex justify-between items-center bg-black/40 backdrop-blur-md px-4 py-2 rounded-full border border-white/10">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${activeCall.status === 'ongoing' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500 animate-ping'}`} />
                <span className="text-xs font-semibold text-white uppercase tracking-wider">
                  {activeCall.status === 'ringing' ? 'Calling...' : activeCall.type === 'video' ? 'Video Call' : 'Voice Call'}
                </span>
              </div>
              <span className="text-xs font-mono text-gray-300">
                {activeCall.status === 'ongoing' ? formatDuration(callDuration) : 'Connecting...'}
              </span>
            </div>

            {/* Remote Video or Voice UI */}
            {activeCall.type === 'video' ? (
              remoteStream ? (
                <video 
                  ref={el => { if (el) el.srcObject = remoteStream; }} 
                  autoPlay 
                  playsInline 
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center gap-4">
                  <div className="w-24 h-24 bg-[#2d333b] rounded-full flex items-center justify-center text-gray-400 animate-pulse">
                    <Users size={44} />
                  </div>
                  <p className="text-gray-400 text-sm font-medium">
                    {activeCall.status === 'ringing' ? 'Ringing...' : 'Connecting video stream...'}
                  </p>
                </div>
              )
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-6">
                <div className="relative">
                  <div className="w-28 h-28 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl">
                    <Users size={52} />
                  </div>
                  {activeCall.status === 'ongoing' && (
                    <div className="absolute -inset-2 border-2 border-green-500/40 rounded-full animate-ping" />
                  )}
                </div>
                <div className="text-center">
                  <h4 className="text-2xl font-bold text-white mb-1">
                    {friends.find(f => f.uid === (activeCall.callerId === user?.uid ? activeCall.receiverId : activeCall.callerId))?.displayName || 'Friend'}
                  </h4>
                  <p className="text-sm font-semibold tracking-wider text-blue-400 uppercase">
                    {activeCall.status === 'ringing' ? 'Ringing...' : activeCall.status === 'ongoing' ? `Connected (${formatDuration(callDuration)})` : 'Connecting...'}
                  </p>
                </div>
              </div>
            )}

            {/* Local Video Pip */}
            {activeCall.type === 'video' && callStream && (
              <div className="absolute bottom-24 right-6 w-36 aspect-video bg-black rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl z-20">
                <video 
                  ref={el => { if (el) el.srcObject = callStream; }} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Call Controls */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 bg-black/60 backdrop-blur-xl p-3 px-6 rounded-full border border-white/10 z-20">
              <button 
                onClick={toggleMic}
                className={`p-3.5 rounded-full transition-all ${isMicMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                title={isMicMuted ? 'Unmute Mic' : 'Mute Mic'}
              >
                {isMicMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              
              {activeCall.type === 'video' && (
                <button 
                  onClick={toggleVideo}
                  className={`p-3.5 rounded-full transition-all ${isVideoOff ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                  title={isVideoOff ? 'Turn Video On' : 'Turn Video Off'}
                >
                  {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
              )}

              <button 
                onClick={endCall}
                className="p-3.5 bg-red-600 text-white rounded-full hover:bg-red-700 transition-all hover:scale-110 shadow-lg"
                title="End Call"
              >
                <PhoneOff size={22} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Avatar Change Modal */}
      {showAvatarModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[85] flex items-center justify-center p-4">
          <div className="bg-[#2d333b] w-full max-w-md rounded-2xl p-6 shadow-2xl border border-white/10 flex flex-col gap-5 animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Camera size={20} className="text-blue-400" /> Change Profile Picture
              </h3>
              <button onClick={() => { setShowAvatarModal(false); setPreviewAvatar(null); }} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {/* Current / Preview Avatar */}
            <div className="flex items-center justify-center">
              <div className="relative">
                <img 
                  src={previewAvatar || profile?.photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop&crop=face'} 
                  alt="Avatar Preview" 
                  className="w-24 h-24 rounded-full object-cover border-4 border-blue-500 shadow-xl"
                  referrerPolicy="no-referrer"
                />
                {uploading && (
                  <div className="absolute inset-0 bg-black/70 rounded-full flex items-center justify-center">
                    <Loader2 className="animate-spin text-white" size={24} />
                  </div>
                )}
              </div>
            </div>

            {/* Option 1: File Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Option 1: Upload from Device</label>
              <label className="bg-[#1c2128] hover:bg-[#222831] border border-white/10 hover:border-blue-500/50 p-3 rounded-xl cursor-pointer transition-all flex items-center justify-center gap-2 text-sm text-gray-200 font-medium">
                <UploadCloud size={18} className="text-blue-400" />
                {uploading ? 'Processing & Saving Image...' : 'Choose Image File (JPG, PNG, GIF)'}
                <input 
                  type="file" 
                  accept="image/*" 
                  className="hidden" 
                  onChange={handleProfileFileSelect} 
                  disabled={uploading} 
                />
              </label>
            </div>

            {/* Option 2: Image URL */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Option 2: Paste Image URL</label>
              <div className="flex gap-2">
                <input 
                  type="url"
                  placeholder="https://example.com/avatar.jpg"
                  value={customAvatarUrl}
                  onChange={(e) => setCustomAvatarUrl(e.target.value)}
                  className="flex-1 bg-[#1c2128] text-white px-3 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                <button
                  onClick={() => {
                    if (customAvatarUrl.trim()) {
                      applyProfilePhoto(customAvatarUrl.trim());
                    }
                  }}
                  disabled={!customAvatarUrl.trim() || uploading}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  Save URL
                </button>
              </div>
            </div>

            {/* Option 3: Preset Avatars */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-gray-300 uppercase tracking-wider flex items-center gap-1">
                <Sparkles size={14} className="text-yellow-400" /> Option 3: Pick a Preset Avatar
              </label>
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AVATARS.map((url, idx) => (
                  <img 
                    key={idx} 
                    src={url} 
                    alt={`Preset ${idx + 1}`}
                    onClick={() => applyProfilePhoto(url)}
                    className="w-full aspect-square rounded-xl object-cover cursor-pointer border-2 border-transparent hover:border-blue-500 hover:scale-105 transition-all shadow-md"
                    referrerPolicy="no-referrer"
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Admin Panel Modal */}
      {showAdminPanel && isAdminUser && (
        <div className="absolute inset-0 bg-black/85 backdrop-blur-md z-[80] flex items-center justify-center p-4">
          <div className="bg-[#2d333b] w-full max-w-2xl h-[85vh] rounded-2xl overflow-hidden shadow-2xl border border-blue-500/30 flex flex-col animate-in zoom-in-95 duration-200">
            {/* Admin Header */}
            <div className="p-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white flex justify-between items-center shadow-md">
              <div className="flex items-center gap-2">
                <Shield size={20} />
                <h3 className="font-bold text-lg">Admin Control Center</h3>
                <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-mono font-medium">
                  {allUsers.length} Users Registered
                </span>
              </div>
              <button onClick={() => setShowAdminPanel(false)} className="text-white hover:bg-white/10 p-1.5 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            {/* Admin Filters & Search */}
            <div className="p-4 bg-[#22272e] border-b border-white/5 flex flex-col md:flex-row gap-3 justify-between items-center">
              <div className="relative w-full md:w-64">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input 
                  type="text"
                  placeholder="Search username, code, uid..."
                  value={userSearchQuery}
                  onChange={(e) => setUserSearchQuery(e.target.value)}
                  className="w-full bg-[#1c2128] text-white pl-9 pr-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>

              <div className="flex gap-1.5 w-full md:w-auto overflow-x-auto">
                {(['all', 'admins', 'banned', 'timedout'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setUserFilter(filter)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-semibold capitalize transition-colors ${userFilter === filter ? 'bg-blue-600 text-white' : 'bg-[#1c2128] text-gray-400 hover:text-white'}`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {/* Users List */}
            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar flex flex-col gap-3">
              {loadingUsers ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 className="animate-spin text-blue-400" size={32} />
                </div>
              ) : filteredUsers.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-12">No users matching search query.</p>
              ) : (
                filteredUsers.map(u => {
                  const isTimedOut = u.timeoutUntil && u.timeoutUntil > Date.now();
                  return (
                    <div key={u.uid} className="bg-[#1c2128] p-4 rounded-xl border border-white/5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        {u.photoURL ? (
                          <img src={u.photoURL} alt="" className="w-11 h-11 rounded-full object-cover border border-white/10" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-11 h-11 bg-[#444c56] rounded-full flex items-center justify-center text-gray-300">
                            <Users size={18} />
                          </div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-white font-bold text-sm">{u.displayName}</p>
                            {u.role === 'admin' && (
                              <span className="text-[9px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold uppercase">Owner</span>
                            )}
                            {u.isBanned && (
                              <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-bold uppercase">Banned</span>
                            )}
                            {isTimedOut && (
                              <span className="text-[9px] bg-orange-500 text-white px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-1">
                                <Clock size={9} /> Timed Out ({new Date(u.timeoutUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-400">
                            Code: <span className="font-mono text-blue-400">{u.friendCode}</span> • UID: <span className="font-mono text-gray-500 text-[10px]">{u.uid.substring(0, 8)}...</span>
                          </p>
                          {u.warnings && u.warnings.length > 0 && (
                            <p className="text-[10px] text-yellow-400 mt-0.5 font-medium">
                              ⚠️ {u.warnings.length} warning{u.warnings.length > 1 ? 's' : ''} issued
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Admin Quick Action Buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => {
                            setWarnModalUser(u);
                            setWarningMessage('Please respect server and chat guidelines.');
                          }}
                          className="text-xs bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 border border-yellow-500/20 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1"
                        >
                          <AlertTriangle size={12} /> Warn
                        </button>

                        <button
                          onClick={() => setTimeoutModalUser(u)}
                          className="text-xs bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 border border-orange-500/20 px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1"
                        >
                          <Clock size={12} /> Timeout
                        </button>

                        <button
                          onClick={() => handleToggleBan(u)}
                          className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors flex items-center gap-1 ${u.isBanned ? 'bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'}`}
                        >
                          <Ban size={12} /> {u.isBanned ? 'Unban' : 'Ban'}
                        </button>

                        <button
                          onClick={() => handleToggleRole(u)}
                          className="text-xs bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-600/20 px-3 py-1.5 rounded-lg font-semibold transition-colors"
                          title="Toggle Admin Role"
                        >
                          {u.role === 'admin' ? 'Remove Admin' : 'Make Admin'}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Warn Modal (Fast React Dialog) */}
      {warnModalUser && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-[#2d333b] w-full max-w-sm rounded-2xl p-5 shadow-2xl border border-yellow-500/30 flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-white flex items-center gap-2">
                <AlertTriangle size={18} className="text-yellow-400" /> Warn {warnModalUser.displayName}
              </h4>
              <button onClick={() => setWarnModalUser(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            
            <div className="flex flex-col gap-2">
              <span className="text-xs text-gray-400">Quick reasons:</span>
              <div className="flex flex-wrap gap-1.5">
                {['Spamming chat', 'Inappropriate behavior', 'Mic spam / screaming', 'Music trolling'].map(reason => (
                  <button 
                    key={reason}
                    type="button"
                    onClick={() => setWarningMessage(reason)}
                    className="text-[11px] bg-[#1c2128] hover:bg-[#2d333b] text-gray-300 px-2.5 py-1 rounded border border-white/5"
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleSendWarning} className="flex flex-col gap-3">
              <input
                type="text"
                value={warningMessage}
                onChange={(e) => setWarningMessage(e.target.value)}
                placeholder="Enter warning message..."
                className="bg-[#1c2128] text-white px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-yellow-500"
                required
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setWarnModalUser(null)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-white">
                  Cancel
                </button>
                <button type="submit" className="bg-yellow-500 hover:bg-yellow-600 text-black font-bold px-4 py-1.5 rounded-lg text-xs transition-colors">
                  Send Warning
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Timeout Modal (Fast React Dialog) */}
      {timeoutModalUser && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[90] flex items-center justify-center p-4">
          <div className="bg-[#2d333b] w-full max-w-sm rounded-2xl p-5 shadow-2xl border border-orange-500/30 flex flex-col gap-4 animate-in zoom-in-95">
            <div className="flex justify-between items-center">
              <h4 className="font-bold text-white flex items-center gap-2">
                <Clock size={18} className="text-orange-400" /> Timeout {timeoutModalUser.displayName}
              </h4>
              <button onClick={() => setTimeoutModalUser(null)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: '5 Minutes', mins: 5 },
                { label: '15 Minutes', mins: 15 },
                { label: '1 Hour', mins: 60 },
                { label: '24 Hours', mins: 1440 },
              ].map(opt => (
                <button
                  key={opt.mins}
                  onClick={() => handleApplyTimeout(timeoutModalUser, opt.mins)}
                  className="bg-[#1c2128] hover:bg-orange-500/20 text-white hover:text-orange-400 border border-white/5 hover:border-orange-500/40 p-2.5 rounded-xl text-xs font-semibold transition-all"
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {timeoutModalUser.timeoutUntil && timeoutModalUser.timeoutUntil > Date.now() && (
              <button
                onClick={() => handleApplyTimeout(timeoutModalUser, 0)}
                className="bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 p-2 rounded-xl text-xs font-bold transition-colors"
              >
                Clear Current Timeout
              </button>
            )}
          </div>
        </div>
      )}

      {/* Profile Viewer Modal */}
      {viewingProfile && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm z-[80] flex items-center justify-center p-6">
          <div className="bg-[#2d333b] w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-white/10 animate-in zoom-in-95 duration-200">
            <div className="relative h-24 bg-gradient-to-br from-blue-600 to-indigo-700">
              <button 
                onClick={() => setViewingProfile(null)}
                className="absolute top-3 right-3 p-1.5 bg-black/20 hover:bg-black/40 text-white rounded-full transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="px-6 pb-6 -mt-10">
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  {viewingProfile.photoURL ? (
                    <img 
                      src={viewingProfile.photoURL} 
                      alt="" 
                      className="w-20 h-20 rounded-full border-4 border-[#2d333b] object-cover shadow-lg" 
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="w-20 h-20 bg-[#444c56] rounded-full border-4 border-[#2d333b] flex items-center justify-center text-gray-400">
                      <Users size={32} />
                    </div>
                  )}
                  {viewingProfile.currentSong && (
                    <div className="absolute bottom-0 right-0 bg-green-500 w-6 h-6 rounded-full border-4 border-[#2d333b] flex items-center justify-center">
                      <Music size={12} className="text-white" />
                    </div>
                  )}
                </div>
                
                <div className="mt-3">
                  <div className="flex items-center justify-center gap-2">
                    <h3 className="text-xl font-bold text-white">{viewingProfile.displayName}</h3>
                    {viewingProfile.role === 'admin' && (
                      <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Owner</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mt-1">Code: <span className="font-mono text-white font-bold">{viewingProfile.friendCode}</span></p>
                </div>

                {viewingProfile.currentSong && (
                  <div className="mt-6 w-full bg-[#1c2128] p-4 rounded-xl border border-green-500/20">
                    <p className="text-[10px] text-green-500 font-bold uppercase tracking-widest mb-3 text-left">Currently Listening</p>
                    <div className="flex items-center gap-3">
                      <img src={viewingProfile.currentSong.coverUrl} alt="" className="w-12 h-12 rounded-lg shadow-md object-cover" referrerPolicy="no-referrer" />
                      <div className="text-left min-w-0">
                        <p className="text-sm font-bold text-white truncate">{viewingProfile.currentSong.title}</p>
                        <p className="text-xs text-gray-400 truncate">{viewingProfile.currentSong.artist}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-6 w-full flex gap-3">
                  <button 
                    onClick={() => { setActiveChat(viewingProfile); setViewingProfile(null); }}
                    className="flex-1 bg-white text-black py-2.5 rounded-xl font-bold hover:bg-gray-200 transition-colors text-sm"
                  >
                    Send Message
                  </button>
                  <button 
                    onClick={() => { 
                      setActiveChat(viewingProfile);
                      setViewingProfile(null); 
                      startCall('voice'); 
                    }}
                    className="p-2.5 bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded-xl transition-colors"
                    title="Voice Call"
                  >
                    <Phone size={20} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
