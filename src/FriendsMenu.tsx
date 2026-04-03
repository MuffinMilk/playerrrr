import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Check, X, Copy, LogIn, LogOut, Loader2, Music, ArrowLeft, Camera, Phone, Video, PhoneOff, Mic, MicOff, VideoOff, Plus } from 'lucide-react';
import { auth, db, storage } from './firebase';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, User, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { collection, query, where, onSnapshot, setDoc, doc, getDocs, deleteDoc, addDoc, updateDoc, orderBy, limit } from 'firebase/firestore';
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

interface Announcement {
  id: string;
  text: string;
  authorId: string;
  authorName: string;
  createdAt: number;
}

interface Message {
  id: string;
  senderId: string;
  receiverId: string;
  conversationId: string;
  text: string;
  createdAt: number;
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

export default function FriendsMenu({ onClose }: { onClose: () => void }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [friendCodeInput, setFriendCodeInput] = useState('');
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);
  
  // Chat states
  const [activeChat, setActiveChat] = useState<UserProfile | null>(null);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [messages, setMessages] = useState<(Message | GroupMessage)[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const typingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Group creation states
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [viewingProfile, setViewingProfile] = useState<UserProfile | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isAnnouncing, setIsAnnouncing] = useState(false);
  const [announcementText, setAnnouncementText] = useState('');

  // Call states
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [incomingCall, setIncomingCall] = useState<Call | null>(null);
  const [callStream, setCallStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const pcRef = React.useRef<RTCPeerConnection | null>(null);

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
    let unsubGroups: (() => void) | null = null;
    let unsubAnnouncements: (() => void) | null = null;

    const unsubscribeAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      // Cleanup previous listeners
      if (unsubscribeProfile) unsubscribeProfile();
      if (unsubscribeRequests) unsubscribeRequests();
      if (unsubF1) unsubF1();
      if (unsubF2) unsubF2();
      if (unsubFriends) unsubFriends();
      if (unsubGroups) unsubGroups();
      if (unsubAnnouncements) unsubAnnouncements();

      if (currentUser) {
        const userRef = doc(db, 'users', currentUser.uid);
        unsubscribeProfile = onSnapshot(userRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);
            
            // Ensure owner has admin role even if profile already existed
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
          snapshot.forEach(doc => reqs.push({ id: doc.id, ...doc.data() } as FriendRequest));
          setRequests(reqs);
        }, (error) => handleFirestoreError(error, OperationType.LIST, 'friendRequests'));

        const qGroups = query(collection(db, 'groups'), where('members', 'array-contains', currentUser.uid));
        unsubGroups = onSnapshot(qGroups, (snapshot) => {
          const gList: Group[] = [];
          snapshot.forEach(doc => gList.push({ id: doc.id, ...doc.data() } as Group));
          setGroups(gList);
        }, (error) => handleFirestoreError(error, OperationType.LIST, 'groups'));

        const qAnnouncements = query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(20));
        unsubAnnouncements = onSnapshot(qAnnouncements, (snapshot) => {
          const aList: Announcement[] = [];
          snapshot.forEach(doc => aList.push({ id: doc.id, ...doc.data() } as Announcement));
          setAnnouncements(aList);
        }, (error) => handleFirestoreError(error, OperationType.LIST, 'announcements'));

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
      if (unsubGroups) unsubGroups();
      if (unsubAnnouncements) unsubAnnouncements();
    };
  }, []);

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

      const unsub = onSnapshot(q, (snap) => {
        const msgs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
        setMessages(msgs);
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'messages'));

      return () => unsub();
    } else if (activeGroup) {
      const q = query(
        collection(db, 'groupMessages'),
        where('groupId', '==', activeGroup.id)
      );

      const unsub = onSnapshot(q, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as GroupMessage));
        setMessages(msgs.sort((a, b) => a.createdAt - b.createdAt));
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'groupMessages'));

      return () => unsub();
    } else {
      setMessages([]);
    }
  }, [user, activeChat, activeGroup]);

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
        // Only set if not already in a call
        if (!activeCall && !incomingCall) {
          setIncomingCall(callData);
        }
      } else {
        setIncomingCall(null);
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'calls'));

    return () => unsubscribe();
  }, [user, activeCall, incomingCall]);

  // Listen for active call updates (answer, ended)
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
      } else if (data.status === 'ongoing' && data.answer && !pcRef.current?.remoteDescription) {
        const remoteDesc = new RTCSessionDescription(data.answer);
        await pcRef.current?.setRemoteDescription(remoteDesc);
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `calls/${activeCall.id}`));

    return () => unsubscribe();
  }, [activeCall, user]);

  // Listen for ICE candidates
  useEffect(() => {
    if (!activeCall || !user) return;

    const q = query(
      collection(db, `calls/${activeCall.id}/candidates`),
      where('senderId', '!=', user.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as CallCandidate;
          if (pcRef.current) {
            const candidate = new RTCIceCandidate(data.candidate);
            await pcRef.current.addIceCandidate(candidate);
          }
        }
      });
    }, (error) => handleFirestoreError(error, OperationType.LIST, `calls/${activeCall.id}/candidates`));

    return () => unsubscribe();
  }, [activeCall, user]);

  useEffect(() => {
    if (!activeChat && user) {
      setDoc(doc(db, 'users', user.uid), { typingTo: '' }, { merge: true }).catch(console.error);
    }
  }, [activeChat, user]);

  const warnUser = async (targetUser: UserProfile, text: string) => {
    if (!profile || profile.role !== 'admin') return;
    const userRef = doc(db, 'users', targetUser.uid);
    const newWarning = { text, createdAt: Date.now() };
    try {
      await updateDoc(userRef, {
        warnings: [...(targetUser.warnings || []), newWarning]
      });
      setSuccess(`Warned ${targetUser.displayName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
      setError('Failed to warn user');
    }
  };

  const timeoutUser = async (targetUser: UserProfile, minutes: number) => {
    if (!profile || profile.role !== 'admin') return;
    const userRef = doc(db, 'users', targetUser.uid);
    const timeoutUntil = Date.now() + minutes * 60000;
    try {
      await updateDoc(userRef, { timeoutUntil });
      setSuccess(`Timed out ${targetUser.displayName} for ${minutes} minutes`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
      setError('Failed to timeout user');
    }
  };

  const banUser = async (targetUser: UserProfile) => {
    if (!profile || profile.role !== 'admin') return;
    const userRef = doc(db, 'users', targetUser.uid);
    try {
      await updateDoc(userRef, { isBanned: true });
      setSuccess(`Banned ${targetUser.displayName}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUser.uid}`);
      setError('Failed to ban user');
    }
  };

  const sendAnnouncement = async () => {
    if (!profile || profile.role !== 'admin' || !announcementText.trim()) return;
    try {
      await addDoc(collection(db, 'announcements'), {
        text: announcementText.trim(),
        authorId: user?.uid,
        authorName: profile?.displayName || user?.displayName || 'Admin',
        createdAt: Date.now()
      });
      setAnnouncementText('');
      setIsAnnouncing(false);
      setSuccess('Announcement sent!');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'announcements');
      setError('Failed to send announcement');
    }
  };

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
    if (!newMessage.trim() || !user || (!activeChat && !activeGroup)) return;

    if (profile?.timeoutUntil && profile.timeoutUntil > Date.now()) {
      setError(`You are timed out until ${new Date(profile.timeoutUntil).toLocaleString()}`);
      return;
    }

    try {
      console.log('Sending message...', { activeChat, activeGroup, newMessage });
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
    } catch (err) {
      console.error('Failed to send message', err);
      setError('Failed to send message. Please try again.');
      const path = activeChat ? 'messages' : 'groupMessages';
      try {
        handleFirestoreError(err, OperationType.CREATE, path);
      } catch (e) {
        // handleFirestoreError throws, which is expected for the AIS Agent
      }
    }
  };

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !groupName.trim() || selectedFriends.length < 1) return;

    try {
      const groupRef = await addDoc(collection(db, 'groups'), {
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
    } catch (err) {
      console.error('Failed to create group', err);
      setError('Failed to create group.');
      try {
        handleFirestoreError(err, OperationType.CREATE, 'groups');
      } catch (e) {}
    }
  };

  const toggleFriendSelection = (uid: string) => {
    setSelectedFriends(prev => 
      prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]
    );
  };

  const setupPeerConnection = (callId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
      ]
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && user) {
        addDoc(collection(db, `calls/${callId}/candidates`), {
          callId,
          senderId: user.uid,
          candidate: event.candidate.toJSON(),
          createdAt: Date.now()
        }).catch(console.error);
      }
    };

    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
    };

    pcRef.current = pc;
    return pc;
  };

  const startCall = async (type: 'voice' | 'video') => {
    if (!user || !activeChat) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video'
      });
      setCallStream(stream);

      const callRef = await addDoc(collection(db, 'calls'), {
        callerId: user.uid,
        receiverId: activeChat.uid,
        status: 'ringing',
        type,
        createdAt: Date.now()
      });

      const pc = setupPeerConnection(callRef.id);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      await updateDoc(callRef, {
        offer: { type: offer.type, sdp: offer.sdp }
      });

      setActiveCall({ id: callRef.id, callerId: user.uid, receiverId: activeChat.uid, status: 'ringing', type, createdAt: Date.now() });
    } catch (err) {
      console.error('Failed to start call', err);
      setError('Could not access camera/microphone.');
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || !user) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: incomingCall.type === 'video'
      });
      setCallStream(stream);

      const pc = setupPeerConnection(incomingCall.id);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      const offer = new RTCSessionDescription(incomingCall.offer);
      await pc.setRemoteDescription(offer);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await updateDoc(doc(db, 'calls', incomingCall.id), {
        answer: { type: answer.type, sdp: answer.sdp },
        status: 'ongoing'
      });

      setActiveCall({ ...incomingCall, status: 'ongoing' });
      setIncomingCall(null);
    } catch (err) {
      console.error('Failed to accept call', err);
      setError('Could not access camera/microphone.');
    }
  };

  const endCall = async () => {
    if (!activeCall) return;
    try {
      await updateDoc(doc(db, 'calls', activeCall.id), { status: 'ended' });
    } catch (err) {
      console.error('Failed to end call', err);
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
                  <div className="flex items-center gap-2">
                    <p className="text-white font-medium">{profile?.displayName}</p>
                    {profile?.role === 'admin' && (
                      <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Owner</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 flex items-center gap-1">
                    Code: <span className="font-mono text-white tracking-wider">{profile?.friendCode}</span>
                  </p>
                  {profile?.createdAt && (
                    <p className="text-[10px] text-gray-500 mt-0.5">
                      Joined {new Date(profile.createdAt).toLocaleDateString()}
                    </p>
                  )}
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

            {/* Announcements Section */}
            {(announcements.length > 0 || profile?.role === 'admin') && (
              <div className="bg-[#2d333b] p-4 rounded-xl border border-blue-500/20">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-medium text-blue-400 uppercase tracking-wider flex items-center gap-2">
                    <Music size={16} /> Announcements
                  </h4>
                  {profile?.role === 'admin' && (
                    <button 
                      onClick={() => setIsAnnouncing(true)}
                      className="p-1.5 bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 rounded-lg transition-colors"
                      title="New Announcement"
                    >
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                <div className="space-y-3 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                  {announcements.length === 0 ? (
                    <p className="text-xs text-gray-500 italic">No recent announcements.</p>
                  ) : (
                    announcements.map(a => (
                      <div key={a.id} className="bg-[#1c2128] p-3 rounded-lg border border-white/5">
                        <p className="text-xs text-white leading-relaxed">{a.text}</p>
                        <div className="mt-2 flex items-center justify-between">
                          <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">{a.authorName}</span>
                          <span className="text-[10px] text-gray-500">{new Date(a.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Add Friend & Create Group */}
            <div className="flex gap-4">
              <div className="bg-[#2d333b] p-4 rounded-xl flex-1">
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
              </div>
              <div className="bg-[#2d333b] p-4 rounded-xl flex items-center justify-center">
                <button 
                  onClick={() => setIsCreatingGroup(true)}
                  className="w-12 h-12 bg-blue-600 text-white rounded-full flex items-center justify-center hover:bg-blue-700 transition-colors shadow-lg"
                  title="Create Group Chat"
                >
                  <Plus size={24} />
                </button>
              </div>
            </div>

            {isCreatingGroup && (
              <div className="bg-[#2d333b] p-4 rounded-xl border border-blue-500/30">
                <div className="flex justify-between items-center mb-4">
                  <h4 className="text-sm font-medium text-white uppercase tracking-wider">Create Group Chat</h4>
                  <button onClick={() => setIsCreatingGroup(false)} className="text-gray-400 hover:text-white">
                    <X size={18} />
                  </button>
                </div>
                <form onSubmit={createGroup} className="flex flex-col gap-4">
                  <input
                    type="text"
                    placeholder="Group Name"
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="bg-[#1c2128] text-white px-4 py-2 rounded-lg outline-none focus:ring-2 focus:ring-white/20"
                    required
                  />
                  <div className="max-h-40 overflow-y-auto custom-scrollbar flex flex-col gap-2">
                    <p className="text-xs text-gray-400 mb-1">Select Friends:</p>
                    {friends.map(friend => (
                      <div 
                        key={friend.uid}
                        onClick={() => toggleFriendSelection(friend.uid)}
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors ${selectedFriends.includes(friend.uid) ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-[#1c2128] border border-transparent hover:border-white/10'}`}
                      >
                        {friend.photoURL ? (
                          <img src={friend.photoURL} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-6 h-6 bg-[#444c56] rounded-full flex items-center justify-center">
                            <Users size={12} />
                          </div>
                        )}
                        <span className="text-sm text-white flex-1">{friend.displayName}</span>
                        {selectedFriends.includes(friend.uid) && <Check size={14} className="text-blue-400" />}
                      </div>
                    ))}
                  </div>
                  <button 
                    type="submit" 
                    disabled={!groupName.trim() || selectedFriends.length < 1}
                    className="bg-white text-black px-4 py-2 rounded-lg font-medium hover:bg-gray-200 transition-colors disabled:opacity-50"
                  >
                    Create Group
                  </button>
                </form>
              </div>
            )}

            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}


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

            {/* Friends & Groups List */}
            <div className="bg-[#2d333b] p-4 rounded-xl flex-1 flex flex-col min-h-0">
              {(activeChat || activeGroup) ? (
                <div className="flex flex-col h-full">
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-[#444c56]">
                    <div className="flex items-center gap-3">
                      <button onClick={() => { setActiveChat(null); setActiveGroup(null); }} className="p-1 hover:bg-[#444c56] rounded-md transition-colors text-gray-400 hover:text-white">
                        <ArrowLeft size={20} />
                      </button>
                      {activeChat ? (
                        <div 
                          className="flex items-center gap-3 cursor-pointer hover:bg-[#444c56] p-1 rounded-lg transition-colors"
                          onClick={() => setViewingProfile(activeChat)}
                        >
                          {activeChat.photoURL ? (
                            <img src={activeChat.photoURL} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
                          ) : (
                            <div className="w-8 h-8 bg-[#444c56] rounded-full flex items-center justify-center">
                              <Users size={14} />
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
                              <span className="text-[10px] text-green-400 truncate max-w-[120px]">
                                Listening to {activeChat.currentSong.title}
                              </span>
                            ) : (
                              <span className="text-[10px] text-gray-500">Online</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="w-8 h-8 bg-blue-600/20 rounded-full flex items-center justify-center text-blue-400">
                            <Users size={14} />
                          </div>
                          <span className="text-white font-medium">{activeGroup?.name}</span>
                        </>
                      )}
                    </div>
                    
                    {activeChat && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => startCall('voice')}
                          className="p-2 hover:bg-[#444c56] rounded-full transition-colors text-gray-400 hover:text-green-400"
                          title="Voice Call"
                        >
                          <Phone size={20} />
                        </button>
                        <button 
                          onClick={() => startCall('video')}
                          className="p-2 hover:bg-[#444c56] rounded-full transition-colors text-gray-400 hover:text-blue-400"
                          title="Video Call"
                        >
                          <Video size={20} />
                        </button>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 mb-4 pr-2">
                    {messages.length === 0 ? (
                      <p className="text-gray-500 text-sm text-center my-auto">Say hi!</p>
                    ) : (
                      messages.map(msg => {
                        const isMe = msg.senderId === user.uid;
                        const gMsg = msg as GroupMessage;
                        return (
                          <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                            {!isMe && activeGroup && (
                              <div className="flex items-center gap-1 mb-1 ml-1">
                                {gMsg.senderPhoto ? (
                                  <img src={gMsg.senderPhoto} alt="" className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
                                ) : (
                                  <div className="w-4 h-4 bg-[#444c56] rounded-full" />
                                )}
                                <span className="text-[10px] text-gray-500">{gMsg.senderName}</span>
                                {gMsg.senderRole === 'admin' && (
                                  <span className="text-[8px] bg-blue-500 text-white px-1 py-0.5 rounded font-bold uppercase tracking-wider">Owner</span>
                                )}
                              </div>
                            )}
                            <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${isMe ? 'bg-blue-600 text-white rounded-tr-sm' : 'bg-[#1c2128] text-gray-200 rounded-tl-sm'}`}>
                              <p className="text-sm break-words">{msg.text}</p>
                            </div>
                          </div>
                        );
                      })
                    )}
                    {activeChat?.typingTo === user.uid && (
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
                      onChange={activeChat ? handleTyping : (e) => setNewMessage(e.target.value)}
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
                  <div className="flex flex-col gap-6 flex-1 min-h-0">
                    {/* Groups Section */}
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Groups</h4>
                      <div className="flex flex-col gap-2">
                        {groups.length === 0 ? (
                          <p className="text-gray-500 text-xs italic">No group chats yet.</p>
                        ) : (
                          groups.map(group => (
                            <div 
                              key={group.id}
                              onClick={() => setActiveGroup(group)}
                              className="flex items-center gap-3 bg-[#1c2128] p-3 rounded-lg cursor-pointer hover:bg-[#30363d] transition-colors"
                            >
                              <div className="w-10 h-10 bg-blue-600/20 rounded-full flex items-center justify-center text-blue-400">
                                <Users size={20} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-white font-medium truncate">{group.name}</p>
                                <p className="text-xs text-gray-500">{group.members.length} members</p>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Friends Section */}
                    <div className="flex-1 flex flex-col min-h-0">
                      <h4 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">Friends</h4>
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
                                  <div className="flex items-center gap-2">
                                    <p className="text-white font-medium truncate">{friend.displayName}</p>
                                    {friend.role === 'admin' && (
                                      <span className="text-[9px] bg-blue-500 text-white px-1 py-0.5 rounded font-bold uppercase tracking-wider">Owner</span>
                                    )}
                                  </div>
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
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Incoming Call Notification */}
      {incomingCall && (
        <div className="absolute top-6 left-6 right-6 bg-[#2d333b] border border-blue-500/50 rounded-2xl p-4 shadow-2xl z-[60] animate-in slide-in-from-top duration-300">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-400 animate-pulse">
                {incomingCall.type === 'video' ? <Video size={24} /> : <Phone size={24} />}
              </div>
              <div>
                <p className="text-white font-bold">Incoming {incomingCall.type} call</p>
                <p className="text-gray-400 text-sm">From {friends.find(f => f.uid === incomingCall.callerId)?.displayName || 'Friend'}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button 
                onClick={() => updateDoc(doc(db, 'calls', incomingCall.id), { status: 'ended' })}
                className="p-3 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-full transition-colors"
              >
                <PhoneOff size={24} />
              </button>
              <button 
                onClick={acceptCall}
                className="p-3 bg-green-500 text-white hover:bg-green-600 rounded-full transition-colors"
              >
                <Phone size={24} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Call Overlay */}
      {activeCall && (
        <div className="absolute inset-0 bg-black/90 z-[70] flex flex-col items-center justify-center p-6">
          <div className="relative w-full max-w-2xl aspect-video bg-[#1c2128] rounded-3xl overflow-hidden shadow-2xl border border-white/10">
            {/* Remote Video */}
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
                  <div className="w-24 h-24 bg-[#2d333b] rounded-full flex items-center justify-center text-gray-500 animate-pulse">
                    <Users size={48} />
                  </div>
                  <p className="text-gray-400">{activeCall.status === 'ringing' ? 'Calling...' : 'Connecting...'}</p>
                </div>
              )
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-6">
                <div className="relative">
                  <div className="w-32 h-32 bg-blue-500/10 rounded-full flex items-center justify-center text-blue-400 animate-pulse">
                    <Users size={64} />
                  </div>
                  <div className="absolute inset-0 border-4 border-blue-500/30 rounded-full animate-ping" />
                </div>
                <div className="text-center">
                  <h4 className="text-2xl font-bold text-white mb-2">
                    {friends.find(f => f.uid === (activeCall.callerId === user?.uid ? activeCall.receiverId : activeCall.callerId))?.displayName || 'Friend'}
                  </h4>
                  <p className="text-blue-400 font-medium uppercase tracking-widest text-sm">
                    {activeCall.status === 'ringing' ? 'Ringing...' : 'Ongoing Call'}
                  </p>
                </div>
                {/* Hidden audio element for voice calls */}
                {remoteStream && (
                  <audio ref={el => { if (el) el.srcObject = remoteStream; }} autoPlay />
                )}
              </div>
            )}

            {/* Local Video (Picture in Picture) */}
            {activeCall.type === 'video' && callStream && (
              <div className="absolute bottom-6 right-6 w-1/4 aspect-video bg-black rounded-xl overflow-hidden border-2 border-white/20 shadow-xl">
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
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-6 bg-black/40 backdrop-blur-xl p-4 px-8 rounded-full border border-white/10">
              <button 
                onClick={toggleMic}
                className={`p-4 rounded-full transition-all ${isMicMuted ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
              >
                {isMicMuted ? <MicOff size={24} /> : <Mic size={24} />}
              </button>
              
              {activeCall.type === 'video' && (
                <button 
                  onClick={toggleVideo}
                  className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                >
                  {isVideoOff ? <VideoOff size={24} /> : <Video size={24} />}
                </button>
              )}

              <button 
                onClick={endCall}
                className="p-4 bg-red-600 text-white rounded-full hover:bg-red-700 transition-all hover:scale-110 shadow-lg"
              >
                <PhoneOff size={28} />
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Viewing Profile Modal */}
      {viewingProfile && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[80] flex items-center justify-center p-6">
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
                  <p className="text-gray-400 text-sm mt-1">Code: <span className="font-mono text-white">{viewingProfile.friendCode}</span></p>
                  {viewingProfile.createdAt && (
                    <p className="text-[10px] text-gray-500 mt-2 uppercase tracking-widest">
                      Member since {new Date(viewingProfile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    </p>
                  )}
                </div>

                {viewingProfile.currentSong && (
                  <div className="mt-6 w-full bg-[#1c2128] p-4 rounded-xl border border-green-500/20">
                    <p className="text-[10px] text-green-500 font-bold uppercase tracking-widest mb-3 text-left">Currently Listening</p>
                    <div className="flex items-center gap-3">
                      <img src={viewingProfile.currentSong.coverUrl} alt="" className="w-12 h-12 rounded-lg shadow-md" referrerPolicy="no-referrer" />
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
                    onClick={() => { startCall('voice'); setViewingProfile(null); }}
                    className="p-2.5 bg-[#444c56] text-white rounded-xl hover:bg-[#535c68] transition-colors"
                  >
                    <Phone size={20} />
                  </button>
                </div>

                {profile?.role === 'admin' && viewingProfile.uid !== user?.uid && (
                  <div className="mt-6 w-full pt-6 border-t border-white/10">
                    <p className="text-[10px] text-red-500 font-bold uppercase tracking-widest mb-3 text-left">Admin Actions</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button 
                        onClick={() => {
                          const text = prompt('Enter warning message:');
                          if (text) warnUser(viewingProfile, text);
                        }}
                        className="bg-yellow-500/10 text-yellow-500 py-2 rounded-lg text-xs font-bold hover:bg-yellow-500/20 transition-colors border border-yellow-500/20"
                      >
                        Warn
                      </button>
                      <button 
                        onClick={() => {
                          const mins = prompt('Enter timeout minutes:');
                          if (mins) timeoutUser(viewingProfile, parseInt(mins));
                        }}
                        className="bg-orange-500/10 text-orange-500 py-2 rounded-lg text-xs font-bold hover:bg-orange-500/20 transition-colors border border-orange-500/20"
                      >
                        Timeout
                      </button>
                      <button 
                        onClick={() => {
                          if (confirm(`Are you sure you want to ban ${viewingProfile.displayName}?`)) {
                            banUser(viewingProfile);
                          }
                        }}
                        className="bg-red-500/10 text-red-500 py-2 rounded-lg text-xs font-bold hover:bg-red-500/20 transition-colors border border-red-500/20 col-span-2"
                      >
                        Ban User
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {isAnnouncing && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[90] flex items-center justify-center p-6">
          <div className="bg-[#2d333b] w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl border border-blue-500/30 animate-in zoom-in-95 duration-200">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Music className="text-blue-400" size={20} /> New Announcement
                </h3>
                <button onClick={() => setIsAnnouncing(false)} className="text-gray-400 hover:text-white">
                  <X size={20} />
                </button>
              </div>
              <textarea
                value={announcementText}
                onChange={(e) => setAnnouncementText(e.target.value)}
                placeholder="What would you like to announce to everyone?"
                className="w-full bg-[#1c2128] text-white p-4 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/50 border border-[#444c56] h-32 resize-none text-sm leading-relaxed"
              />
              <div className="mt-6 flex gap-3">
                <button 
                  onClick={() => setIsAnnouncing(false)}
                  className="flex-1 bg-[#444c56] text-white py-2.5 rounded-xl font-bold hover:bg-[#535c68] transition-colors text-sm"
                >
                  Cancel
                </button>
                <button 
                  onClick={sendAnnouncement}
                  disabled={!announcementText.trim()}
                  className="flex-1 bg-blue-600 text-white py-2.5 rounded-xl font-bold hover:bg-blue-700 transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Post Announcement
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
