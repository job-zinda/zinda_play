import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Search, Plus, Film, LayoutDashboard, X, Trash2, ExternalLink, Sparkles, LogOut, Pencil, Tags, Share2, Eye, EyeOff, BarChart3, Upload, Bell, Check, Clock3, WalletCards, Heart, MessageCircle, UserRound, UserPlus, TrendingUp, Building2, ChevronLeft, ChevronRight, Flame, RefreshCw, SearchX, WifiOff, Menu } from "lucide-react";
import VideoCard, { VideoCardSkeleton } from "./VideoCard.jsx";
import { AdSlot, AdminAds, PlayerGate, recordInterest } from "./Ads.jsx";
import { IntroVideo, IntroManager } from "./IntroVideo.jsx";
import { AdminMembership, CreatorMembership } from "./Membership.jsx";
import { BusinessAds } from "./BusinessAds.jsx";
import { AdminShortReports } from "./ShortReports.jsx";
import Shorts from "./Shorts.jsx";
import { referralUrl, shareLink, videoShareUrl } from "./public-links.js";

const API = import.meta.env.DEV
  ? "/api"
  : `${(import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/+$/, "")}/api`;
const blank = { title: "", description: "", categoryId: "cat-learning", thumbnailUrl: "", playbackUrl: "", promotionUrl: "", promotionType: "product", collectionName: "", collectionType: "series", episodeNumber: "", targetCity: "", featured: false, published: true };
const blankBanner = { enabled: false, title: "", description: "", imageUrl: "", buttonLabel: "", buttonUrl: "" };
const apiAssetSrc = imageUrl => !imageUrl
  ? ""
  : /^https?:\/\//i.test(imageUrl)
    ? imageUrl
    : `${API}${imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`}`;
const isDirectVideoUrl = url => /\.(mp4|webm|ogv|ogg)(?:$|[?#])/i.test(url);
function App() {
  const [videos, setVideos] = useState([]);
  const [publicVideos, setPublicVideos] = useState([]);
  const [categories, setCategories] = useState([]);
  const [banner, setBanner] = useState(null);
  const [bannerForm, setBannerForm] = useState(blankBanner);
  const [bannerImageFile, setBannerImageFile] = useState(null);
  const [bannerImageProgress, setBannerImageProgress] = useState(0);
  const [bannerImageUploading, setBannerImageUploading] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeCollectionKey, setActiveCollectionKey] = useState("");
  const [page, setPage] = useState(() => new URLSearchParams(window.location.search).has("short") ? "shorts" : "home");
  const [initialShortId, setInitialShortId] = useState(() => new URLSearchParams(window.location.search).get("short") || null);
  const [referrerPromoterId, setReferrerPromoterId] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("ref");
    const saved = localStorage.getItem("referrerPromoterId");
    const referralId = /^[a-f0-9]{24}$/i.test(fromUrl || "") ? fromUrl : saved;
    if (referralId && /^[a-f0-9]{24}$/i.test(referralId)) localStorage.setItem("referrerPromoterId", referralId);
    return referralId && /^[a-f0-9]{24}$/i.test(referralId) ? referralId : "";
  });
  const referralEntryHandled = useRef(false);
  const [profileDrawerOpen, setProfileDrawerOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(blank);
  const [editingId, setEditingId] = useState(null);
  const [thumbnailFile, setThumbnailFile] = useState(null);
  const [categoryName, setCategoryName] = useState("");
  const [returnToContent, setReturnToContent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sortMode, setSortMode] = useState("latest");
  const [cardLikes, setCardLikes] = useState({});
  const trendingRow = useRef(null);
  const cardLikeRequests = useRef(new Set());
  const [adminToken, setAdminToken] = useState(() => sessionStorage.getItem("adminToken") || "");
  const [authRole, setAuthRole] = useState(() => sessionStorage.getItem("authRole") || (sessionStorage.getItem("adminToken") ? "admin" : ""));
  const [signedInUsername, setSignedInUsername] = useState(() => sessionStorage.getItem("signedInUsername") || "");
  const [promoterAccount, setPromoterAccount] = useState(() => sessionStorage.getItem("promoterAccount") === "true" || sessionStorage.getItem("authRole") === "promoter");
  const [switchingMode, setSwitchingMode] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [pendingMembers, setPendingMembers] = useState([]);
  const [pendingCreatorVideos, setPendingCreatorVideos] = useState([]);
  const [pendingPromoterWithdrawals, setPendingPromoterWithdrawals] = useState([]);
  const [videoRejectionReasons, setVideoRejectionReasons] = useState({});
  const [videoPreviewOpen, setVideoPreviewOpen] = useState({});
  const [creatorStats, setCreatorStats] = useState(null);
  const [wallet, setWallet] = useState(null);
  const [promoterWallet, setPromoterWallet] = useState(null);
  const [promoterPayoutHandle, setPromoterPayoutHandle] = useState("");
  const [promoterWithdrawals, setPromoterWithdrawals] = useState([]);
  const [withdrawalRejectionReasons, setWithdrawalRejectionReasons] = useState({});
  const [watchSession, setWatchSession] = useState(null);
  const watchActiveSeconds = useRef(0);
  const [videoInteractions, setVideoInteractions] = useState({ likeCount: 0, commentCount: 0, liked: false, comments: [] });
  const [creatorFollowData, setCreatorFollowData] = useState({ creatorId: "", followerCount: 0, following: false, isSelf: false });
  const [creatorFollowLoading, setCreatorFollowLoading] = useState(false);
  const [creatorFollowSubmitting, setCreatorFollowSubmitting] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [likeSubmitting, setLikeSubmitting] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [profilePhotoFile, setProfilePhotoFile] = useState(null);
  const [profilePhotoPreview, setProfilePhotoPreview] = useState("");
  const [accountProfile, setAccountProfile] = useState({ displayName: "", bio: "", profilePhotoUrl: "" });
  const [registrationType, setRegistrationType] = useState("member");
  const [businessProfile, setBusinessProfile] = useState({ businessName: "", businessAbout: "", logoUrl: "" });
  const [businessCreators, setBusinessCreators] = useState([]);
  const [businessInvitations, setBusinessInvitations] = useState([]);
  const [businessVideos, setBusinessVideos] = useState([]);
  const [creatorInvitations, setCreatorInvitations] = useState([]);
  const [selectedCreatorId, setSelectedCreatorId] = useState("");
  const [businessInviteMessage, setBusinessInviteMessage] = useState("");
  const [creatorProfileDetail, setCreatorProfileDetail] = useState(null);
  const [myCreatorProfile, setMyCreatorProfile] = useState(null);
  const [discoverCreators, setDiscoverCreators] = useState([]);
  const [popularCreators, setPopularCreators] = useState([]);
  const [membership, setMembership] = useState(null);
  const [creatorReferrals, setCreatorReferrals] = useState(null);
  const [membershipPaying, setMembershipPaying] = useState(false);
  const [upgradeReminderHidden, setUpgradeReminderHidden] = useState(false);
  const [discoverBrands, setDiscoverBrands] = useState([]);
  const [discoverCreatorProfile, setDiscoverCreatorProfile] = useState(null);
  const [discoverBrandProfile, setDiscoverBrandProfile] = useState(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverFollowSubmitting, setDiscoverFollowSubmitting] = useState(false);
  const [adminCreators, setAdminCreators] = useState([]);
  const [chatThread, setChatThread] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatPeer, setChatPeer] = useState(null);
  const [adminChatList, setAdminChatList] = useState([]);
  const [creatorRequests, setCreatorRequests] = useState([]);
  const [adminCreatorId, setAdminCreatorId] = useState("");
  const [adminCreatorText, setAdminCreatorText] = useState("");
  const [adminCreatorRequestId, setAdminCreatorRequestId] = useState("");
  const [profileEditPhoto, setProfileEditPhoto] = useState(null);
  const [profileEditPhotoPreview, setProfileEditPhotoPreview] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const sponsoredImpressions = useRef(new Set());

  async function load() {
    setLoading(true); setError(""); setLoadFailed(false);
    try {
      const [v, c, b, pc] = await Promise.all([
        fetch(`${API}/videos`).then(r => r.json()),
        fetch(`${API}/categories`).then(r => r.json()),
        fetch(`${API}/banner`).then(r => r.json()),
        fetch(`${API}/discover/popular-creators`).then(r => r.ok ? r.json() : []).catch(() => [])
      ]);
      if (!Array.isArray(v) || !Array.isArray(c)) throw new Error("Invalid API response");
      setPublicVideos(v); setCategories(c); setBanner(b); setPopularCreators(Array.isArray(pc) ? pc : []);
    } catch { setLoadFailed(true); setError("Could not connect to the API. Check VITE_API_URL and make sure the backend is available."); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    if (page === "home") load();
  }, [page, authRole]);
  useEffect(() => {
    if (!profileDrawerOpen) return undefined;
    const closeOnEscape = event => {
      if (event.key === "Escape") setProfileDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [profileDrawerOpen]);
  useEffect(() => {
    if (authRole !== "creator" || !adminToken) return;
    loadAccountProfile().catch(err => setError(err.message));
    loadMembership().catch(() => {});
  }, [adminToken, authRole]);
  useEffect(() => {
    const creatorId = selected?.creatorProfile?.id;
    if (!creatorId) {
      setCreatorFollowData({ creatorId: "", followerCount: 0, following: false, isSelf: false });
      return undefined;
    }
    let stopped = false;
    setCreatorFollowLoading(true);
    const headers = adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
    fetch(`${API}/creators/${encodeURIComponent(creatorId)}/follow`, { headers })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load creator followers.");
        if (!stopped) setCreatorFollowData(data);
      })
      .catch(err => {
        if (!stopped) setError(err.message);
      })
      .finally(() => {
        if (!stopped) setCreatorFollowLoading(false);
      });
    return () => { stopped = true; };
  }, [selected?.creatorProfile?.id, adminToken]);
  useEffect(() => {
    if (!profileEditPhoto) {
      setProfileEditPhotoPreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(profileEditPhoto);
    setProfileEditPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [profileEditPhoto]);
  useEffect(() => {
    if (!profilePhotoFile) {
      setProfilePhotoPreview("");
      return undefined;
    }
    const previewUrl = URL.createObjectURL(profilePhotoFile);
    setProfilePhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [profilePhotoFile]);
  useEffect(() => {
    if (!referrerPromoterId || adminToken || referralEntryHandled.current) return;
    referralEntryHandled.current = true;
    setPage("admin");
    setRegistering(true);
    setRegistrationType("member");
  }, [referrerPromoterId, adminToken]);
  useEffect(() => {
    if (page !== "home" || loading || !window.IntersectionObserver) return undefined;
    const observer = new IntersectionObserver(entries=>{
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = entry.target;
        const videoId = card.getAttribute("data-video-id");
        if (!videoId || sponsoredImpressions.current.has(videoId)) continue;
        sponsoredImpressions.current.add(videoId);
        fetch(`${API}/videos/${encodeURIComponent(videoId)}/impression`, { method: "POST" })
          .then(async response=>{
            if (!response.ok) {
              const data=await response.json();
              throw new Error(data.error || "Could not record a sponsored video impression.");
            }
          })
          .catch(err=>setError(err.message));
      }
    },{threshold:0.5});
    document.querySelectorAll(".vcard[data-sponsored='true']").forEach(card=>observer.observe(card));
    return ()=>observer.disconnect();
  },[publicVideos,search,activeCategory,loading,page]);
  useEffect(() => { setCardLikes({}); }, [adminToken]);
  useEffect(() => {
    if (!watchSession || selected?.id !== watchSession.videoId) return undefined;
    watchActiveSeconds.current = 0;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      watchActiveSeconds.current += 1;
      if (watchActiveSeconds.current < watchSession.requiredWatchSeconds || Date.now() - watchSession.startedAtMs < watchSession.requiredWatchSeconds * 1000) return;
      window.clearInterval(timer);
      try {
        const response = await fetch(`${API}/videos/${encodeURIComponent(watchSession.videoId)}/watch-complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ watchId: watchSession.watchId, activeSeconds: watchActiveSeconds.current })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to record this eligible watch.");
        if (data.counted) {
          setError(data.rewardRupees
            ? `Eligible watch recorded. You earned ₹${data.rewardRupees} in promoter rewards.`
            : "Eligible watch recorded toward promoter rewards.");
          if (authRole === "promoter") await loadPromoterWallet();
        }
      } catch (err) {
        setError(err.message);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [watchSession, selected?.id, adminToken, authRole]);
  const sponsoredVideos = useMemo(() => publicVideos.filter(video => video.isSponsored), [publicVideos]);
  const publicLibraryVideos = useMemo(() => publicVideos.filter(video =>
    video.published &&
    video.ownerType !== "business" &&
    video.approvalStatus !== "pending" &&
    (!video.bunnyVideoId || video.processingStatus === "ready") &&
    !video.isSponsored
  ), [publicVideos]);
  const trendingVideos = useMemo(() => [...publicLibraryVideos]
    .filter(video => Number(video.views || 0) > 0)
    .sort((a, b) => Number(b.views || 0) - Number(a.views || 0))
    .slice(0, 10), [publicLibraryVideos]);
  const collectionGroups = useMemo(() => {
    const groups = new Map();
    publicLibraryVideos.filter(video => video.collectionName && ["series", "playlist"].includes(video.collectionType)).forEach(video => {
      const creatorId = video.creatorProfile?.id || "admin";
      const key = `${video.collectionType}:${creatorId}:${video.collectionName.trim().toLowerCase()}`;
      if (!groups.has(key)) groups.set(key, {
        key,
        title: video.collectionName.trim(),
        type: video.collectionType,
        creatorName: video.creatorProfile?.displayName || "",
        videos: []
      });
      groups.get(key).videos.push(video);
    });
    return [...groups.values()].map(collection => ({
      ...collection,
      videos: collection.videos.sort((a, b) =>
        (a.episodeNumber || Number.MAX_SAFE_INTEGER) - (b.episodeNumber || Number.MAX_SAFE_INTEGER) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    }));
  }, [publicLibraryVideos]);
  const filtered = useMemo(() => {
    if (activeCollectionKey) return collectionGroups.find(collection => collection.key === activeCollectionKey)?.videos || [];
    const matches = publicLibraryVideos.filter(video =>
      (!search || `${video.title} ${video.description} ${video.collectionName || ""}`.toLowerCase().includes(search.toLowerCase())) &&
      (activeCategory === "all" || video.categoryId === activeCategory)
    );
    const views = video => Number(video.views || 0);
    const ageDays = video => Math.max(0, (Date.now() - new Date(video.createdAt).getTime()) / 86400000) || 0;
    if (sortMode === "viewed") return [...matches].sort((a, b) => views(b) - views(a));
    // Trending favors views earned relative to how recently the video was published.
    if (sortMode === "trending") return [...matches].sort((a, b) => views(b) / (1 + ageDays(b)) - views(a) / (1 + ageDays(a)));
    return [...matches].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [publicLibraryVideos, collectionGroups, activeCollectionKey, search, activeCategory, sortMode]);
  const featured = filtered.find(v => v.featured) || filtered[0];
  const analytics = useMemo(() => {
    const totalViews = videos.reduce((total, video) => total + Number(video.views || 0), 0);
    const topVideos = [...videos].sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
    const categoryStats = categories.map(category => {
      const categoryVideos = videos.filter(video => video.categoryId === category.id);
      return {
        ...category,
        videos: categoryVideos.length,
        views: categoryVideos.reduce((total, video) => total + Number(video.views || 0), 0)
      };
    }).sort((a, b) => b.views - a.views);
    return { totalViews, topVideos, categoryStats };
  }, [videos, categories]);

  async function watchVideo(video) {
    if (video.videoType === "short") {
      setSelected(null); setInitialShortId(video.id); setPage("shorts");
      return;
    }
    recordInterest(video.categoryId);
    setSelected(video);
    setWatchSession(null);
    setVideoInteractions({ likeCount: 0, commentCount: 0, liked: false, comments: [] });
    setCommentText("");
    try {
      const canEarnPromoterRewards = adminToken && ["member", "creator", "promoter"].includes(authRole);
      const [viewResponse, interactionsResponse, watchStartResponse] = await Promise.all([
        fetch(`${API}/videos/${video.id}/view`, { method: "POST" }),
        fetch(`${API}/videos/${video.id}/interactions`, adminToken ? { headers: { Authorization: `Bearer ${adminToken}` } } : {}),
        canEarnPromoterRewards
          ? fetch(`${API}/videos/${encodeURIComponent(video.id)}/watch-start`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } })
          : Promise.resolve(null)
      ]);
      const [viewData, interactionsData] = await Promise.all([viewResponse.json(), interactionsResponse.json()]);
      if (!viewResponse.ok) throw new Error(viewData.error || "Unable to record this view");
      if (!interactionsResponse.ok) throw new Error(interactionsData.error || "Unable to load video likes and comments.");
      let watchStart = null;
      if (watchStartResponse) {
        watchStart = await watchStartResponse.json();
        if (!watchStartResponse.ok) throw new Error(watchStart.error || "Unable to start promoter reward tracking.");
      }
      setVideos(current => current.map(item => item.id === video.id ? { ...item, views: viewData.views } : item));
      setPublicVideos(current => current.map(item => item.id === video.id ? { ...item, views: viewData.views } : item));
      setSelected(current => current?.id === video.id ? { ...current, views: viewData.views } : current);
      setVideoInteractions(interactionsData);
      if (watchStart) setWatchSession({
        videoId: video.id,
        watchId: watchStart.watchId,
        requiredWatchSeconds: watchStart.requiredWatchSeconds,
        startedAtMs: Date.now()
      });
    } catch (err) {
      setError(err.message || "Unable to record this view");
    }
  }
  const canLike = () => Boolean(adminToken) && ["member", "creator", "promoter"].includes(authRole);
  async function warmCardLike(video) {
    if (cardLikes[video.id] || cardLikeRequests.current.has(video.id)) return;
    cardLikeRequests.current.add(video.id);
    try {
      const response = await fetch(`${API}/videos/${video.id}/interactions`, adminToken ? { headers: { Authorization: `Bearer ${adminToken}` } } : {});
      const data = await response.json();
      if (response.ok) setCardLikes(current => ({ ...current, [video.id]: { liked: data.liked, likeCount: data.likeCount } }));
    } catch { /* like state stays hidden until the next hover */ }
    finally { cardLikeRequests.current.delete(video.id); }
  }
  async function toggleCardLike(video) {
    if (!canLike()) { setError("Sign in with a viewer account to like videos."); return; }
    try {
      const response = await fetch(`${API}/videos/${video.id}/like`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update your like.");
      setCardLikes(current => ({ ...current, [video.id]: { liked: data.liked, likeCount: data.likeCount } }));
    } catch (err) { setError(err.message); }
  }
  async function openCreatorFromCard(creator) {
    setPage("discover");
    setSelected(null);
    await openDiscover();
    await openDiscoveredCreator(creator);
  }
  const scrollTrending = direction => {
    const row = trendingRow.current;
    if (row) row.scrollBy({ left: direction * Math.max(240, row.clientWidth * .8), behavior: "smooth" });
  };
  const hasActiveFilters = Boolean(search) || activeCategory !== "all" || sortMode !== "latest" || Boolean(activeCollectionKey);
  const clearFilters = () => { setSearch(""); setActiveCategory("all"); setSortMode("latest"); setActiveCollectionKey(""); };
  const renderCard = (video, index, rank) => <VideoCard key={video.id} video={video} index={index} rank={rank} assetSrc={apiAssetSrc} like={cardLikes[video.id]} onOpen={watchVideo} onShare={shareVideo} onCreator={openCreatorFromCard} onLike={toggleCardLike} onWarmLike={warmCardLike}/>;

  const isViewerRole = ["creator", "member", "promoter"].includes(authRole);
  function openMenu() {
    setProfileDrawerOpen(true);
    if (isViewerRole && adminToken) loadAccountProfile().catch(err => setError(err.message));
  }
  function previewBusinessVideo(video) {
    setPage("home");
    setWatchSession(null);
    setSelected({ ...video, isBusinessPreview: true });
    setVideoInteractions({ likeCount: 0, commentCount: 0, liked: false, comments: [] });
    setCommentText("");
  }
  async function shareVideo(video) {
    try {
      const result = await shareLink(video.title, videoShareUrl(video.id));
      if (result === "copied") setError("Video link copied to clipboard.");
    } catch (err) {
      setError(err.message || "Unable to share this video.");
    }
  }
  function closeVideo() {
    setSelected(null);
    setWatchSession(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("video");
    window.history.replaceState({}, "", url);
  }
  useEffect(() => {
    const videoId = new URLSearchParams(window.location.search).get("video");
    const video = publicVideos.find(item => item.id === videoId);
    if (video && !selected) watchVideo(video);
  }, [publicVideos, selected]);

  function clearAdminSession() {
    sessionStorage.removeItem("adminToken");
    sessionStorage.removeItem("authRole");
    sessionStorage.removeItem("signedInUsername");
    sessionStorage.removeItem("promoterAccount");
    setPromoterAccount(false);
    setAdminToken("");
    setAuthRole("");
    setSignedInUsername("");
    setNotifications([]);
    setUnreadNotifications(0);
    setPendingMembers([]);
    setPendingPromoterWithdrawals([]);
  }
  async function loadAdmin(token = adminToken) {
    const r = await fetch(`${API}/admin/videos`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    if (r.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your admin session expired. Please sign in again.");
    }
    if (!r.ok) throw new Error(data.error || "Unable to load admin videos");
    setVideos(data);
    const bannerResponse = await fetch(`${API}/admin/banner`, { headers: { Authorization: `Bearer ${token}` } });
    const bannerData = await bannerResponse.json();
    if (bannerResponse.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your admin session expired. Please sign in again.");
    }
    if (!bannerResponse.ok) throw new Error(bannerData.error || "Unable to load banner settings");
    setBannerForm({ ...blankBanner, ...bannerData });
  }
  async function loadNotifications(token = adminToken, role = authRole) {
    const response = await fetch(`${API}/notifications`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.error || "Unable to load notifications.");
    setNotifications(data.notifications);
    setUnreadNotifications(data.unreadCount);
    if (data.role || data.approvalStatus) {
      const nextRole = data.role || (data.approvalStatus === "approved" ? "creator" : "member");
      setAuthRole(nextRole);
      sessionStorage.setItem("authRole", nextRole);
    }
    if (role === "admin") {
      const [membersResponse, videosResponse, withdrawalsResponse] = await Promise.all([
        fetch(`${API}/admin/members/pending`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/admin/videos/pending-review`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API}/admin/promoter-withdrawals`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      const [members, videos, withdrawals] = await Promise.all([membersResponse.json(), videosResponse.json(), withdrawalsResponse.json()]);
      if (!membersResponse.ok) throw new Error(members.error || "Unable to load creator applications.");
      if (!videosResponse.ok) throw new Error(videos.error || "Unable to load creator videos awaiting review.");
      if (!withdrawalsResponse.ok) throw new Error(withdrawals.error || "Unable to load promoter withdrawals awaiting review.");
      setPendingMembers(members);
      setPendingCreatorVideos(videos);
      setPendingPromoterWithdrawals(withdrawals);
    }
  }
  async function loadCreator(token = adminToken) {
    const [videoResponse, statsResponse] = await Promise.all([
      fetch(`${API}/creator/videos`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API}/creator/analytics`, { headers: { Authorization: `Bearer ${token}` } })
    ]);
    const [videoData, statsData] = await Promise.all([videoResponse.json(), statsResponse.json()]);
    if (videoResponse.status === 401 || statsResponse.status === 401) {
      clearAdminSession();
      setPage("admin");
    }
    if (!videoResponse.ok) throw new Error(videoData.error || "Unable to load your videos.");
    if (!statsResponse.ok) throw new Error(statsData.error || "Unable to load your analytics.");
    setVideos(videoData);
    setCreatorStats(statsData);
  }
  async function loadWallet(token = adminToken) {
    const response = await fetch(`${API}/creator/wallet`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) {
      clearAdminSession();
      setPage("admin");
    }
    if (!response.ok) throw new Error(data.error || "Unable to load your wallet.");
    setWallet(data);
  }
  async function loadPromoterWallet(token = adminToken) {
    const response = await fetch(`${API}/promoter/wallet`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) {
      clearAdminSession();
      setPage("admin");
    }
    if (!response.ok) throw new Error(data.error || "Unable to load your promoter wallet.");
    setPromoterWallet(data);
  }
  async function loadAccountProfile() {
    const response = await fetch(`${API}/account`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await response.json();
    if (response.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error(data.error || "Your session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.error || "Unable to load your profile.");
    setPromoterAccount(data.promoterAccount === true);
    sessionStorage.setItem("promoterAccount", String(data.promoterAccount === true));
    setAccountProfile({
      displayName: data.displayName || data.username || "",
      bio: data.bio || "",
      profilePhotoUrl: data.profilePhotoUrl || ""
    });
    setProfileEditPhoto(null);
  }
  async function loadBusiness(token = adminToken) {
    const headers = { Authorization: `Bearer ${token}` };
    const responses = await Promise.all([
      fetch(`${API}/business/profile`, { headers }),
      fetch(`${API}/business/creators`, { headers }),
      fetch(`${API}/business/creator-requests`, { headers }),
      fetch(`${API}/business/videos`, { headers })
    ]);
    const [profile, creators, invitations, videos] = await Promise.all(responses.map(response=>response.json()));
    if (responses.some(response=>response.status===401)) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your business session expired. Please sign in again.");
    }
    for (let i=0;i<responses.length;i++) if (!responses[i].ok) {
      throw new Error([profile, creators, invitations, videos][i].error || "Unable to load your business workspace.");
    }
    setBusinessProfile({ businessName: profile.businessName || "", businessAbout: profile.businessAbout || "", logoUrl: profile.logoUrl || "" });
    setBusinessCreators(creators);
    setBusinessInvitations(invitations);
    setBusinessVideos(videos);
  }
  async function refreshBusinessVideos(token = adminToken) {
    const response = await fetch(`${API}/business/videos`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your business session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.error || "Unable to refresh your business videos.");
    setBusinessVideos(data);
  }
  async function loadCreatorInvitations(token = adminToken) {
    const response = await fetch(`${API}/creator/invitations`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your creator session expired. Please sign in again.");
    }
    if (!response.ok) throw new Error(data.error || "Unable to load brand invitations.");
    setCreatorInvitations(data);
  }
  async function openCreatorProfile(creator) {
    setError("");
    try {
      const response = await fetch(`${API}/business/creators/${encodeURIComponent(creator.id)}`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load this creator profile.");
      setCreatorProfileDetail(data);
      setSelectedCreatorId(data.id);
    } catch (err) {
      setError(err.message);
    }
  }
  async function openDiscover() {
    setError("");
    setSelected(null);
    setDiscoverCreatorProfile(null);
    setDiscoverBrandProfile(null);
    setProfileDrawerOpen(false);
    setPage("discover");
    setDiscoverLoading(true);
    try {
      const [creatorsResponse, brandsResponse] = await Promise.all([
        fetch(`${API}/discover/creators`),
        fetch(`${API}/discover/brands`)
      ]);
      const [creators, brands] = await Promise.all([creatorsResponse.json(), brandsResponse.json()]);
      if (!creatorsResponse.ok) throw new Error(creators.error || "Unable to load creator profiles.");
      if (!brandsResponse.ok) throw new Error(brands.error || "Unable to load business profiles.");
      setDiscoverCreators(creators);
      setDiscoverBrands(brands);
    } catch (err) {
      setError(err.message);
    } finally {
      setDiscoverLoading(false);
    }
  }
  async function openDiscoveredCreator(creator) {
    setError("");
    setDiscoverBrandProfile(null);
    try {
      const response = await fetch(`${API}/creators/${encodeURIComponent(creator.id)}/profile`, {
        headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {}
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load this creator profile.");
      setDiscoverCreatorProfile(data);
    } catch (err) {
      setError(err.message);
    }
  }
  async function toggleDiscoveredCreatorFollow() {
    if (!discoverCreatorProfile) return;
    if (!adminToken || !["member", "creator", "promoter"].includes(authRole)) {
      setPage("admin");
      setError("Sign in with a viewer account to follow creators.");
      return;
    }
    setDiscoverFollowSubmitting(true);
    try {
      const response = await fetch(`${API}/creators/${encodeURIComponent(discoverCreatorProfile.id)}/follow`, {
        method: discoverCreatorProfile.following ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update creator follow.");
      setDiscoverCreatorProfile(current => current ? { ...current, following: data.following, followerCount: data.followerCount } : current);
    } catch (err) {
      setError(err.message);
    } finally {
      setDiscoverFollowSubmitting(false);
    }
  }
  async function openProfile() {
    setError("");
    setPage("profile");
    try { await loadAccountProfile(); }
    catch (err) { setError(err.message); }
  }
  async function openMyCreatorProfile() {
    setError("");
    setProfileDrawerOpen(false);
    setMyCreatorProfile(null);
    setPage("my-creator-profile");
    try {
      const response = await fetch(`${API}/creator/profile`, {
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load your creator profile.");
      setMyCreatorProfile(data);
    } catch (err) {
      setError(err.message);
    }
  }
  async function saveProfile(event) {
    event.preventDefault();
    setError("");
    if (profileEditPhoto) {
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(profileEditPhoto.type)) {
        setError("Choose a JPEG, PNG, WebP, or GIF profile photo.");
        return;
      }
      if (profileEditPhoto.size > 8 * 1024 * 1024) {
        setError("Profile photos are limited to 8 MB.");
        return;
      }
    }
    setProfileSaving(true);
    try {
      const response = await fetch(`${API}/account`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ displayName: accountProfile.displayName, bio: accountProfile.bio })
      });
      const data = await response.json();
      if (response.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!response.ok) throw new Error(data.error || "Unable to save your profile.");
      setAccountProfile(current => ({ ...current, ...data }));
      if (profileEditPhoto) {
        await uploadProfilePhoto(adminToken, profileEditPhoto);
        setProfileEditPhoto(null);
        await loadAccountProfile();
        await load();
      }
      setError("Profile saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setProfileSaving(false);
    }
  }
  async function saveBusinessProfile(event) {
    event.preventDefault();
    setError("");
    const businessName = businessProfile.businessName.trim();
    if (!businessName || businessName.length > 100 || businessProfile.businessAbout.length > 1000) {
      setError("Business name is required (up to 100 characters); description must be 1,000 characters or fewer.");
      return;
    }
    if (profileEditPhoto && (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(profileEditPhoto.type) || profileEditPhoto.size > 8 * 1024 * 1024)) {
      setError("Choose a JPEG, PNG, WebP, or GIF logo up to 8 MB.");
      return;
    }
    setProfileSaving(true);
    try {
      const response = await fetch(`${API}/business/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ businessName, businessAbout: businessProfile.businessAbout })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save your business profile.");
      setBusinessProfile(current=>({...current,...data}));
      if (profileEditPhoto) {
        await uploadProfilePhoto(adminToken, profileEditPhoto, "/business/logo");
        setProfileEditPhoto(null);
      }
      await loadBusiness();
      setError("Business profile saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setProfileSaving(false);
    }
  }
  async function inviteCreator(creator) {
    if (!businessInviteMessage.trim()) {
      setError("Describe what you need before selecting a creator.");
      return;
    }
    try {
      const response = await fetch(`${API}/business/creator-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ creatorId: creator.id, note: businessInviteMessage.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send this request.");
      setBusinessInvitations(current=>[data,...current]);
      setSelectedCreatorId("");
      setBusinessInviteMessage("");
      setError(`${creator.displayName} selected. The Zinda Play admin has been informed.`);
    } catch (err) {
      setError(err.message);
    }
  }
  async function respondToInvitation(invitation, status) {
    try {
      const response = await fetch(`${API}/creator/invitations/${encodeURIComponent(invitation.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to respond to this invitation.");
      setCreatorInvitations(current=>current.map(item=>item.id===data.id?data:item));
      setError(`Invitation from ${invitation.businessName} ${status}.`);
      if (invitation.businessId === "admin") openAdminChat();
    } catch (err) {
      setError(err.message);
    }
  }
  async function openAdminChat(creator) {
    const peer = authRole === "admin" ? { id: creator.creatorId || creator.id, name: creator.creatorName || creator.displayName } : { id: "", name: "Zinda Play" };
    setSelected(null);
    setChatPeer(peer);
    setChatInput("");
    setPage("admin-chat");
    try {
      const headers = { Authorization: `Bearer ${adminToken}` };
      const route = authRole === "admin" ? `/admin/chats/${encodeURIComponent(peer.id)}` : "/creator/admin-chat";
      const response = await fetch(`${API}${route}`, { headers });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to open the chat.");
      setChatThread(data);
      if (authRole === "admin") {
        const list = await fetch(`${API}/admin/chats`, { headers });
        if (list.ok) setAdminChatList(await list.json());
      }
    } catch (err) {
      setError(err.message);
    }
  }
  async function sendAdminChat(event) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text || !chatPeer) return;
    try {
      const route = authRole === "admin" ? `/admin/chats/${encodeURIComponent(chatPeer.id)}` : "/creator/admin-chat";
      const response = await fetch(`${API}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ text })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send this message.");
      setChatThread(current=>[...current,data]);
      setChatInput("");
    } catch (err) {
      setError(err.message);
    }
  }
  async function openAdminChats() {
    setSelected(null);
    setChatPeer(null);
    setChatThread([]);
    setPage("admin-chat");
    try {
      const response = await fetch(`${API}/admin/chats`, { headers: { Authorization: `Bearer ${adminToken}` } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load chats.");
      setAdminChatList(data);
    } catch (err) {
      setError(err.message);
    }
  }
  async function openBrandInvitations() {
    setPage("invitations");
    try { await loadCreatorInvitations(); }
    catch (err) { setError(err.message); }
  }
  async function openWallet() {
    setPage("wallet");
    try { await loadWallet(); }
    catch (err) { setError(err.message); }
  }
  async function openPromoterDashboard() {
    setPage("promoter");
    try { await loadPromoterWallet(); }
    catch (err) { setError(err.message); }
  }
  async function requestPromoterWithdrawal(event) {
    event.preventDefault();
    try {
      const response = await fetch(`${API}/promoter/withdrawals`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ payoutHandle: promoterPayoutHandle })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to request your withdrawal.");
      setPromoterPayoutHandle("");
      await loadPromoterWallet();
      setError("Withdrawal request sent to the administrator for review.");
    } catch (err) {
      setError(err.message);
    }
  }
  async function reviewPromoterWithdrawal(withdrawal, decision) {
    const reason = (withdrawalRejectionReasons[withdrawal.id] || "").trim();
    if (decision === "rejected" && !reason) {
      setError("Enter a reason before rejecting this withdrawal request.");
      return;
    }
    if (decision === "paid" && !window.confirm(`Confirm that ₹${withdrawal.amountRupees} has been manually sent to ${withdrawal.payoutHandle}?`)) return;
    try {
      const response = await fetch(`${API}/admin/promoter-withdrawals/${encodeURIComponent(withdrawal.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ decision, ...(decision === "rejected" ? { reason } : {}) })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to review this withdrawal request.");
      setPendingPromoterWithdrawals(current => current.filter(item => item.id !== withdrawal.id));
      setWithdrawalRejectionReasons(current => {
        const next = { ...current };
        delete next[withdrawal.id];
        return next;
      });
      await loadNotifications();
      setError(decision === "paid" ? `₹${withdrawal.amountRupees} withdrawal marked paid.` : "Withdrawal request rejected.");
    } catch (err) {
      setError(err.message);
    }
  }
  async function copyReferralLink(code = promoterWallet?.referralCode) {
    try {
      const referralLink = referralUrl(code);
      try {
        await navigator.clipboard.writeText(referralLink);
        setError("Your referral link was copied.");
      } catch {
        window.prompt("Copy your referral link:", referralLink);
      }
    } catch (err) {
      setError(err.message);
    }
  }
  async function shareReferralLink(code = promoterWallet?.referralCode) {
    try {
      const result = await shareLink("Join me on Zinda Play", referralUrl(code));
      if (result === "copied") setError("Your referral link was copied.");
    } catch (err) {
      setError(err.message || "Unable to share your invitation.");
    }
  }
  async function loadCreatorReferrals() {
    const response = await fetch(`${API}/creator/referrals`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await response.json();
    if (response.ok) setCreatorReferrals(data);
  }
  async function toggleVideoLike() {
    if (!adminToken || !["member", "creator", "promoter"].includes(authRole)) {
      setError("Sign in to like this video.");
      return;
    }
    setLikeSubmitting(true);
    try {
      const response = await fetch(`${API}/videos/${selected.id}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update your like.");
      setVideoInteractions(current => ({ ...current, liked: data.liked, likeCount: data.likeCount }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLikeSubmitting(false);
    }
  }
  async function toggleCreatorFollow() {
    const creatorId = selected?.creatorProfile?.id;
    if (!creatorId) return;
    if (!adminToken || !["member", "creator", "promoter"].includes(authRole)) {
      closeVideo();
      setPage("admin");
      setError("Sign in with a viewer account to follow creators.");
      return;
    }
    setCreatorFollowSubmitting(true);
    try {
      const response = await fetch(`${API}/creators/${encodeURIComponent(creatorId)}/follow`, {
        method: creatorFollowData.following ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update creator follow.");
      setCreatorFollowData({ ...data, isSelf: false });
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatorFollowSubmitting(false);
    }
  }
  async function submitVideoComment(event) {
    event.preventDefault();
    if (!adminToken || !["member", "creator", "promoter"].includes(authRole)) {
      setError("Sign in to comment on this video.");
      return;
    }
    setCommentSubmitting(true);
    try {
      const response = await fetch(`${API}/videos/${selected.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ text: commentText })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to post your comment.");
      setVideoInteractions(current => ({ ...current, commentCount: current.commentCount + 1, comments: [data, ...current.comments] }));
      setCommentText("");
    } catch (err) {
      setError(err.message);
    } finally {
      setCommentSubmitting(false);
    }
  }
  async function updateMemberDecision(member, approvalStatus) {
    try {
      const response = await fetch(`${API}/admin/members/${encodeURIComponent(member.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ approvalStatus })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to review this application.");
      setPendingMembers(current => current.filter(item => item.id !== member.id));
      await loadNotifications();
      setError(`${member.username}'s creator application was ${approvalStatus}.`);
    } catch (err) {
      setError(err.message);
    }
  }
  async function reviewCreatorVideo(video, decision) {
      const reason = (videoRejectionReasons[video.id] || "").trim();
      if (decision === "rejected" && !reason) {
        setError("Enter a reason before rejecting a video.");
        return;
      }
      try {
        const response = await fetch(`${API}/admin/videos/${encodeURIComponent(video.id)}/review`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ decision, ...(decision === "rejected" ? { reason } : {}) })
        });
        const data = await response.json();
        if (response.status === 401) { clearAdminSession(); setPage("admin"); }
        if (!response.ok) throw new Error(data.error || "Unable to review this video.");
        setPendingCreatorVideos(current => current.filter(item => item.id !== video.id));
        if (decision === "rejected") {
          setVideos(current => current.filter(item => item.id !== video.id));
        } else {
          setVideos(current => current.map(item => item.id === video.id
              ? { ...item, approvalStatus: "approved", published: video.ownerType === "business" ? false : true, ...(video.ownerType === "business" ? { businessCampaignStatus: "unpaid" } : {}) }
            : item));
        }
        setVideoRejectionReasons(current => {
          const next = { ...current };
          delete next[video.id];
          return next;
        });
        await loadAdmin();
        await loadNotifications();
        setError(decision === "approved"
          ? video.ownerType === "business" ? `"${video.title}" was approved. The business can now set its target location and pay to promote it.` : `"${video.title}" was approved and published.`
          : `"${video.title}" was rejected and deleted.`);
      } catch (err) {
        setError(err.message);
    }
  }
  async function markNotificationRead(notification) {
    if (notification.readAt) return;
    try {
      const response = await fetch(`${API}/notifications/${encodeURIComponent(notification.id)}/read`, {
        method: "POST",
        headers: { Authorization: `Bearer ${adminToken}` }
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Unable to update notification.");
      }
      setNotifications(current => current.map(item => item.id === notification.id ? { ...item, readAt: new Date().toISOString() } : item));
      setUnreadNotifications(count => Math.max(0, count - 1));
    } catch (err) {
      setError(err.message);
    }
  }
  async function openCreatorRequests() {
    setSelected(null);
    setPage("creator-requests");
    const headers = { Authorization: `Bearer ${adminToken}` };
    try {
      const [creatorsResponse, requestsResponse] = await Promise.all([
        fetch(`${API}/admin/creators`, { headers }),
        fetch(`${API}/admin/creator-requests`, { headers })
      ]);
      const [creators, requests] = await Promise.all([creatorsResponse.json(), requestsResponse.json()]);
      if (!creatorsResponse.ok) throw new Error(creators.error || "Unable to load creators.");
      if (!requestsResponse.ok) throw new Error(requests.error || "Unable to load creator requests.");
      setAdminCreators(creators);
      setCreatorRequests(requests);
    } catch (err) {
      setError(err.message);
    }
  }
  async function dismissCreatorRequest(request) {
    try {
      const response = await fetch(`${API}/admin/creator-requests/${encodeURIComponent(request.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ status: "dismissed" })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to dismiss this request.");
      setCreatorRequests(current=>current.map(item=>item.id===data.id?data:item));
    } catch (err) {
      setError(err.message);
    }
  }
  async function sendToCreator(kind) {
    const text = adminCreatorText.trim();
    if (!adminCreatorId || !text) return;
    try {
      const response = await fetch(`${API}/admin/${kind === "invitation" ? "invitations" : "messages"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ creatorId: adminCreatorId, requestId: adminCreatorRequestId || undefined, [kind === "invitation" ? "message" : "text"]: text })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to send this to the creator.");
      setAdminCreatorText("");
      setAdminCreatorRequestId("");
      setError(kind === "invitation" ? "Invitation sent to the creator." : "Message sent to the creator.");
      await openCreatorRequests();
    } catch (err) {
      setError(err.message);
    }
  }
  async function openNotifications() {
    setPage("notifications");
    if (authRole === "creator") loadCreatorInvitations().catch(()=>{});
    try { await loadNotifications(); }
    catch (err) { setError(err.message); }
  }
  async function loadMembership(token = adminToken) {
    const response = await fetch(`${API}/creator/membership`, { headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (response.ok) setMembership(data);
  }
  async function subscribeMembership() {
    setMembershipPaying(true);
  }
  async function switchAccountMode(mode) {
    setSwitchingMode(true);
    setError("");
    try {
      const response = await fetch(`${API}/account/mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ mode })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not switch account mode.");
      sessionStorage.setItem("authRole", data.role);
      sessionStorage.setItem("promoterAccount", "true");
      setAuthRole(data.role);
      setPromoterAccount(true);
      setProfileDrawerOpen(false);
      setSelected(null);
      setMembershipPaying(false);
      setMembership(null);
      setVideos([]);
      if (data.role === "creator") {
        await loadCreator();
        setPage("creator");
      } else if (data.role === "promoter") {
        await loadPromoterWallet();
        setPage("promoter");
      } else {
        setPage("notifications");
        setError(data.approvalStatus === "rejected" ? "Creator access was declined. You can still switch back to your promoter account." : "Creator application submitted. Admin approval is required; your promoter account and rewards are preserved.");
      }
    } catch (err) { setError(err.message); }
    finally { setSwitchingMode(false); }
  }
  async function openCreatorDashboard() {
    setSelected(null);
    setPage("creator");
    loadMembership().catch(()=>{});
    loadCreatorReferrals().catch(()=>{});
    try { await loadCreator(); }
    catch (err) { setError(err.message); }
  }
  async function refreshProcessing() {
    const route = authRole === "business" ? "/business/videos/processing" : authRole === "creator" ? "/creator/videos/processing" : "/admin/videos/processing";
    const r = await fetch(`${API}${route}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await r.json();
    if (r.status === 401) {
      clearAdminSession();
      setPage("admin");
      throw new Error("Your admin session expired. Please sign in again.");
    }
    if (!r.ok) throw new Error(data.error || "Unable to refresh video processing status");
    if (data.length) {
      const updateVideos = current => current.map(video => {
        const status = data.find(update => update.id === video.id);
        return status ? { ...video, processingStatus: status.processingStatus, encodeProgress: status.encodeProgress } : video;
      });
      if (authRole === "business") {
        setBusinessVideos(updateVideos);
      } else {
        setVideos(updateVideos);
      }
    }
  }
  useEffect(() => {
    if (!["admin", "creator", "business"].includes(authRole) || !(["admin", "creator"].includes(page) || authRole === "business" && page === "business") || !adminToken) return undefined;
    let stopped = false;
    const update = async () => {
      try {
        await refreshProcessing();
      } catch (err) {
        if (!stopped) setError(err.message);
      }
    };
    update();
    const timer = window.setInterval(update, 10000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [page, adminToken, authRole]);
  useEffect(() => {
    if (!adminToken) return undefined;
    let stopped = false;
    const update = async () => {
      try {
        await loadNotifications();
        if (authRole === "creator" && page === "creator") await loadCreator();
        if (authRole === "business" && page === "business") await refreshBusinessVideos();
      } catch (err) {
        if (!stopped) setError(err.message);
      }
    };
    update();
    const timer = window.setInterval(update, 15000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [adminToken, authRole, page]);
  function uploadVideoFile(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const uploadRoute = `/${authRole === "creator" ? "creator" : "admin"}/videos/upload`;
      xhr.open("POST", `${API}${uploadRoute}`);
      xhr.setRequestHeader("Authorization", `Bearer ${adminToken}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("X-Video-Title", form.title);
      xhr.setRequestHeader("X-Video-Description", form.description);
      xhr.setRequestHeader("X-Video-Category", form.categoryId);
        xhr.setRequestHeader("X-Video-Collection-Name", encodeURIComponent(form.collectionName.trim()));
        xhr.setRequestHeader("X-Video-Collection-Type", form.collectionType);
        xhr.setRequestHeader("X-Video-Episode-Number", String(form.episodeNumber));
        xhr.setRequestHeader("X-Video-Target-City", encodeURIComponent(form.targetCity.trim()));
      if (authRole === "creator") {
        xhr.setRequestHeader("X-Video-Promotion-Url", form.promotionUrl.trim());
        xhr.setRequestHeader("X-Video-Promotion-Type", form.promotionType);
      }
      xhr.setRequestHeader("X-Video-Featured", String(form.featured));
      xhr.setRequestHeader("X-Video-Published", String(form.published));
      xhr.setRequestHeader("X-Upload-Size", String(file.size));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => reject(new Error("Video upload failed. Check your connection and try again."));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("The server returned an invalid upload response.")); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Video upload failed."));
          return;
        }
        resolve(data);
      };
      xhr.send(file);
    });
  }
  function uploadBannerImage(file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${API}/admin/banner/image`);
      xhr.setRequestHeader("Authorization", `Bearer ${adminToken}`);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("X-Upload-Size", String(file.size));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setBannerImageProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => reject(new Error("Banner image upload failed. Check your connection and try again."));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("The server returned an invalid banner image response.")); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Banner image upload failed."));
          return;
        }
        resolve(data);
      };
      xhr.send(file);
    });
  }
  function uploadVideoThumbnail(videoId, file) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${API}/${authRole === "creator" ? "creator" : "admin"}/videos/${encodeURIComponent(videoId)}/thumbnail`);
      xhr.setRequestHeader("Authorization", `Bearer ${adminToken}`);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("X-Upload-Size", String(file.size));
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) setUploadProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.onerror = () => reject(new Error("Thumbnail upload failed. Check your connection and try again."));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("The server returned an invalid thumbnail response.")); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Thumbnail upload failed."));
          return;
        }
        resolve(data);
      };
      xhr.send(file);
    });
  }
  function uploadProfilePhoto(token, file, route = "/account/profile-photo") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", `${API}${route}`);
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.setRequestHeader("X-Upload-Size", String(file.size));
      xhr.onerror = () => reject(new Error("Profile photo upload failed. Check your connection and try again."));
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); }
        catch { reject(new Error("The server returned an invalid profile photo response.")); return; }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new Error(data.error || "Profile photo upload failed."));
          return;
        }
        resolve(data);
      };
      xhr.send(file);
    });
  }
  async function login(e) {
    e.preventDefault(); setError(""); setLoginLoading(true);
    try {
      if (registering && profilePhotoFile) {
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(profilePhotoFile.type)) {
          throw new Error("Choose a JPEG, PNG, WebP, or GIF profile photo.");
        }
        if (profilePhotoFile.size > 8 * 1024 * 1024) {
          throw new Error("Profile photos are limited to 8 MB.");
        }
      }
      const r = await fetch(`${API}/auth/${registering ? "register" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          ...(registering ? {
            accountType: registrationType,
            ...(registrationType === "member" && referrerPromoterId ? { referrerPromoterId } : {}),
            ...(registrationType === "business" ? {
              businessName: businessProfile.businessName,
              businessAbout: businessProfile.businessAbout
            } : {})
          } : {})
        })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Unable to sign in");
      sessionStorage.setItem("adminToken", data.token);
      sessionStorage.setItem("authRole", data.role);
      sessionStorage.setItem("signedInUsername", data.username);
      setAdminToken(data.token);
      setAuthRole(data.role);
      setSignedInUsername(data.username);
      setPromoterAccount(data.promoterAccount === true);
      sessionStorage.setItem("promoterAccount", String(data.promoterAccount === true));
      setPassword("");
      setRegistering(false);
      if (referrerPromoterId && (!registering || registrationType === "member")) {
        localStorage.removeItem("referrerPromoterId");
        setReferrerPromoterId("");
      }
      let profilePhotoError = "";
      if (data.role !== "admin" && profilePhotoFile) {
        try {
          await uploadProfilePhoto(data.token, profilePhotoFile, data.role === "business" ? "/business/logo" : "/account/profile-photo");
        } catch (uploadError) {
          profilePhotoError = `Your account was created, but the profile photo could not be uploaded: ${uploadError.message}`;
        }
      }
      setProfilePhotoFile(null);
      if (data.role === "admin") {
        await loadAdmin(data.token);
        setPage("admin");
      } else if (data.role === "creator") {
        await loadCreator(data.token);
        setPage("creator");
      } else if (data.role === "business") {
        await loadBusiness(data.token);
        setPage("business");
      } else if (data.role === "promoter") {
        await loadPromoterWallet(data.token);
        setPage("promoter");
      } else {
        setPage("notifications");
      }
      if (data.role === "creator") await loadCreatorInvitations(data.token);
      await loadNotifications(data.token, data.role);
      if (profilePhotoError) setError(profilePhotoError);
    } catch (err) {
      setError(err.message || "Unable to sign in");
    } finally {
      setLoginLoading(false);
    }
  }
  async function logout() {
    try {
      await fetch(`${API}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${adminToken}` } });
    } catch {
      setError("Could not contact the server to end your session.");
    } finally {
      setProfileDrawerOpen(false);
      clearAdminSession();
      setRegistering(false);
      setPage("admin");
      setSelected(null);
    }
  }
  async function openAdmin() {
    setSelected(null);
    if (!adminToken || authRole !== "admin") {
      setPage("admin");
      return;
    }
    setPage("admin");
    try { await loadAdmin(); }
    catch (err) { setError(err.message); }
  }
  async function openBusiness() {
    setPage("business");
    try { await loadBusiness(); }
    catch (err) { setError(err.message); }
  }

  async function saveVideo(e) {
    e.preventDefault(); setError("");
    setUploading(Boolean(uploadFile || thumbnailFile));
    setUploadProgress(0);
    try {
      if (uploadFile && uploadFile.size > 2 * 1024 * 1024 * 1024) {
        throw new Error("Video uploads are limited to 2 GB.");
      }
      if (uploadFile && !uploadFile.type.startsWith("video/")) {
        throw new Error("Choose a supported video file.");
      }
      if (thumbnailFile && !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(thumbnailFile.type)) {
        throw new Error("Choose a JPEG, PNG, WebP, or GIF thumbnail.");
      }
      if (thumbnailFile && thumbnailFile.size > 8 * 1024 * 1024) {
        throw new Error("Video thumbnails are limited to 8 MB.");
      }
      if (uploadFile && editingId) {
        throw new Error("Remove the selected file or save this as a new video; replacing uploaded files is not supported.");
      }
      if (authRole === "creator" && !uploadFile && !editingId) {
        throw new Error("Choose a video file to upload.");
      }
      if (authRole === "creator" && form.promotionUrl.trim()) {
        let promotionUrl;
        try { promotionUrl = new URL(form.promotionUrl.trim()); }
        catch { throw new Error("Enter a valid product, service, or course URL."); }
        if (promotionUrl.protocol !== "https:" || promotionUrl.username || promotionUrl.password) {
          throw new Error("Use an HTTPS product, service, or course URL without embedded credentials.");
        }
      }
      let responseData = uploadFile ? await uploadVideoFile(uploadFile) : null;
      if (uploadFile) setUploadFile(null);
      if (!uploadFile && authRole === "creator" && editingId) {
        const r = await fetch(`${API}/creator/videos/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({
            title: form.title,
            description: form.description,
            categoryId: form.categoryId,
            promotionUrl: form.promotionUrl.trim(),
            promotionType: form.promotionType,
            collectionName: form.collectionName.trim(),
            collectionType: form.collectionType,
            episodeNumber: form.episodeNumber,
            targetCity: form.targetCity.trim()
          })
        });
        responseData = await r.json();
        if (r.status === 401) { clearAdminSession(); setPage("admin"); }
        if (!r.ok) throw new Error(responseData.error || "Unable to update video");
      } else if (!uploadFile) {
      const r = await fetch(`${API}/admin/videos${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(form)
      });
      responseData = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(responseData.error || "Unable to save video");
      }
      if (!responseData?.id) throw new Error("The server did not return a saved video.");
      if (thumbnailFile) {
        setEditingId(responseData.id);
        setForm({
          title: responseData.title || "",
          description: responseData.description || "",
          categoryId: responseData.categoryId || "",
          thumbnailUrl: responseData.thumbnailUrl || "",
          playbackUrl: responseData.playbackUrl || "",
          promotionUrl: responseData.promotionUrl || "",
          promotionType: responseData.promotionType || "product",
          collectionName: responseData.collectionName || "",
          collectionType: responseData.collectionType || "series",
          episodeNumber: responseData.episodeNumber || "",
          targetCity: responseData.targetCity || "",
          featured: Boolean(responseData.featured),
          published: Boolean(responseData.published)
        });
        setPage("add");
        responseData = await uploadVideoThumbnail(responseData.id, thumbnailFile);
      }
      if (responseData.bunnyVideoId) setError("Upload complete. Bunny Stream is processing the video; status will update in your dashboard.");
      setThumbnailFile(null);
      setForm(blank); setEditingId(null);
      if (authRole === "creator") {
        setPage("creator");
        await loadCreator();
      } else {
        setPage("admin");
        await loadAdmin();
      }
    } catch (err) { setError(err.message); }
    finally { setUploading(false); }
  }
  function editVideo(video) {
    setForm({
      title: video.title || "",
      description: video.description || "",
      categoryId: video.categoryId || "",
      thumbnailUrl: video.thumbnailUrl || "",
      playbackUrl: video.playbackUrl || "",
      promotionUrl: video.promotionUrl || "",
      promotionType: video.promotionType || "product",
      collectionName: video.collectionName || "",
      collectionType: video.collectionType || "series",
      episodeNumber: video.episodeNumber || "",
      targetCity: video.targetCity || "",
      featured: Boolean(video.featured),
      published: Boolean(video.published)
    });
    setEditingId(video.id);
    setThumbnailFile(null);
    setPage("add");
  }
  async function createCategory(e) {
    e.preventDefault(); setError("");
    try {
      const r = await fetch(`${API}/admin/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ name: categoryName })
      });
      const data = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(data.error || "Unable to create category");
      setCategories(current => [...current, data]);
      setCategoryName("");
      if (returnToContent) {
        setForm(current => ({ ...current, categoryId: data.id }));
        setPage("add");
        setReturnToContent(false);
      }
    } catch (err) { setError(err.message); }
  }
  async function saveBanner(e) {
    e.preventDefault(); setError("");
    try {
      const r = await fetch(`${API}/admin/banner`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(bannerForm)
      });
      const data = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(data.error || "Unable to save banner");
      setBannerForm({ ...blankBanner, ...data });
      setBanner(data.enabled ? data : null);
      setError("Banner settings saved.");
      setPage("admin");
    } catch (err) { setError(err.message); }
  }
  async function saveBannerImage() {
    if (!bannerImageFile) return;
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowedTypes.includes(bannerImageFile.type)) {
      setError("Choose a JPEG, PNG, WebP, or GIF image.");
      return;
    }
    if (bannerImageFile.size > 8 * 1024 * 1024) {
      setError("Banner images are limited to 8 MB.");
      return;
    }
    setError("");
    setBannerImageUploading(true);
    setBannerImageProgress(0);
    try {
      const data = await uploadBannerImage(bannerImageFile);
      setBannerForm(current => ({ ...current, imageUrl: data.imageUrl }));
      setBanner(current => current ? { ...current, imageUrl: data.imageUrl } : current);
      setBannerImageFile(null);
      setError("Banner image uploaded and saved to MongoDB.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBannerImageUploading(false);
    }
  }
  async function deleteVideo(id) {
    if (!confirm("Delete this video? Linked ads will stop. Earned wallet credit and ad history will be retained. This cannot be undone.")) return;
    try {
      const r = await fetch(`${API}/${authRole === "creator" ? "creator" : "admin"}/videos/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${adminToken}` } });
      if (r.status === 401) { clearAdminSession(); setPage("admin"); throw new Error("Your admin session expired. Please sign in again."); }
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Could not delete video.");
      }
      if (authRole === "creator") await loadCreator();
      else await loadAdmin();
    } catch (err) { setError(err.message); }
  }
  async function togglePublished(video) {
    try {
      const r = await fetch(`${API}/admin/videos/${video.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ published: !video.published })
      });
      const data = await r.json();
      if (r.status === 401) { clearAdminSession(); setPage("admin"); }
      if (!r.ok) throw new Error(data.error || "Unable to update publish status");
      setVideos(current => current.map(item => item.id === video.id ? data : item));
    } catch (err) { setError(err.message); }
  }

  function openShorts() {
    setProfileDrawerOpen(false); setSelected(null); setInitialShortId(null); setPage("shorts");
  }

  return <div className={`app-shell${page === "shorts" ? " shorts-page" : ""}`}>
    <header className="topbar"><div className="topbar-left"><button className="menu-trigger" onClick={openMenu} aria-label="Open menu" aria-haspopup="dialog" aria-expanded={profileDrawerOpen}><Menu size={21}/></button><button className="brand" onClick={() => { setPage("home"); setSelected(null); }}><img src="/app-icon.png" width={34} height={34} style={{ objectFit: "contain", flexShrink: 0, borderRadius: 8 }} alt=""/>Zinda<span className="brand-accent">Play</span></button></div>
      <nav>{authRole === "admin" ? <><button className={page === "admin" || page === "add" || page === "banner" || page === "ads" ? "nav-active" : ""} onClick={openAdmin}><LayoutDashboard size={16}/> Dashboard</button><button className={page === "notifications" ? "nav-active" : ""} onClick={openNotifications}><Bell size={16}/> Notifications{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications}</span>}</button><button className="profile-menu-trigger" onClick={openDiscover} aria-label="Discover creator and brand profiles"><UserRound size={18}/></button><button onClick={logout}><LogOut size={16}/> Sign out</button></> : authRole === "business" ? <><button className={page === "business" ? "nav-active" : ""} onClick={openBusiness}><LayoutDashboard size={16}/> Business</button><button className={page === "notifications" ? "nav-active" : ""} onClick={openNotifications}><Bell size={16}/> Notifications</button><button className="profile-menu-trigger" onClick={openDiscover} aria-label="Discover creator and brand profiles"><UserRound size={18}/></button><button onClick={logout}><LogOut size={16}/> Sign out</button></> : ["creator", "member", "promoter"].includes(authRole) ? <><button className={`topbar-notifications ${page === "notifications" ? "nav-active" : ""}`} onClick={openNotifications} aria-label={`Notifications${unreadNotifications ? `, ${unreadNotifications} unread` : ""}`}><Bell size={17}/>{unreadNotifications > 0 && <span className="notification-count">{unreadNotifications}</span>}</button><button className={`profile-menu-trigger ${page === "my-creator-profile" ? "nav-active" : ""}`} onClick={authRole === "creator" ? openMyCreatorProfile : ()=>{setProfileDrawerOpen(true);loadAccountProfile().catch(err=>setError(err.message));}} aria-label={authRole === "creator" ? "View your creator profile" : "Open profile menu"} aria-expanded={authRole === "creator" ? undefined : profileDrawerOpen}>{accountProfile.profilePhotoUrl ? <img src={apiAssetSrc(accountProfile.profilePhotoUrl)} alt=""/> : <UserRound size={18}/>}</button></> : null}</nav>
      <button className="secondary-btn shorts-nav-button" aria-pressed={page === "shorts"} onClick={openShorts}><Play size={16}/> Simply</button>
      <div className="top-pill"><span className="live-dot"/> VIDEO STREAMING</div>
    </header>
    {authRole === "admin" && adminToken && <div className="admin-actions"><button className="secondary-btn" onClick={() => { setSelected(null); setPage("membership-admin"); }}>Membership plans & payments</button></div>}
    {authRole === "creator" && adminToken && page === "creator" && <button className="secondary-btn" onClick={subscribeMembership}>Membership plans, renewal & payment status</button>}
    {membershipPaying && authRole === "creator" && adminToken && <div className="membership-dialog" role="dialog" aria-modal="true" aria-label="Creator membership"><CreatorMembership api={API} token={adminToken} onUpdated={setMembership} onClose={() => setMembershipPaying(false)}/></div>}
    {profileDrawerOpen && <div className="profile-drawer-layer">
      <button className="profile-drawer-backdrop" aria-label="Close profile menu" onClick={()=>setProfileDrawerOpen(false)}/>
      <aside className="profile-drawer" aria-label="Main menu">
        <div className="profile-drawer-heading"><span>MENU</span><button className="icon-btn" aria-label="Close menu" onClick={()=>setProfileDrawerOpen(false)}><X size={19}/></button></div>
        {authRole && <div className="profile-drawer-user">{accountProfile.profilePhotoUrl && isViewerRole ? <img src={apiAssetSrc(accountProfile.profilePhotoUrl)} alt=""/> : <span><UserRound size={24}/></span>}<div><strong>{(isViewerRole && accountProfile.displayName) || signedInUsername}</strong><small>@{signedInUsername}</small></div></div>}
        <div className="profile-drawer-links">
          <button className={page === "home" ? "active" : ""} onClick={()=>{setProfileDrawerOpen(false);setPage("home");setSelected(null);}}><Film size={18}/> Explore</button>
          <button className={page === "shorts" ? "active" : ""} onClick={openShorts}><Play size={18}/> Simply</button>
          <button className={page === "discover" ? "active" : ""} onClick={openDiscover}><Building2 size={18}/> Creators & brands</button>
          {isViewerRole && <button className={page === "profile" ? "active" : ""} onClick={()=>{setProfileDrawerOpen(false);openProfile();}}><UserRound size={18}/> Edit profile</button>}
          {authRole === "creator" && <><button className={page === "creator" || page === "add" || page === "creator-analytics" ? "active" : ""} onClick={()=>{setProfileDrawerOpen(false);openCreatorDashboard();}}><LayoutDashboard size={18}/> Creator studio</button><button className={page === "invitations" ? "active" : ""} onClick={()=>{setProfileDrawerOpen(false);openBrandInvitations();}}><Bell size={18}/> Brand invitations</button><button className={page === "admin-chat" ? "active" : ""} onClick={()=>{setProfileDrawerOpen(false);openAdminChat();}}><MessageCircle size={18}/> Chat with admin</button><button className={page === "wallet" ? "active" : ""} onClick={()=>{setProfileDrawerOpen(false);openWallet();}}><WalletCards size={18}/> Wallet</button></>}
          {authRole === "promoter" && <button className={page === "promoter" ? "active" : ""} onClick={()=>{setProfileDrawerOpen(false);openPromoterDashboard();}}><WalletCards size={18}/> Promoter dashboard</button>}
          {promoterAccount && <button disabled={switchingMode} onClick={() => switchAccountMode(authRole === "promoter" ? "creator" : "promoter")}><RefreshCw size={18}/>{switchingMode ? "Switching..." : authRole === "promoter" ? "Switch to creator / apply" : "Switch to promoter"}</button>}
          {authRole
            ? <button className="profile-drawer-signout" onClick={()=>{setProfileDrawerOpen(false);logout();}}><LogOut size={18}/> Sign out</button>
            : <button className={`profile-drawer-signin ${page === "admin" ? "active" : ""}`} onClick={()=>{setProfileDrawerOpen(false);openAdmin();}}><UserRound size={18}/> Sign in</button>}
        </div>
      </aside>
    </div>}
    <main className={`container${page === "shorts" ? " shorts-container" : ""}`}>
      {authRole === "creator" && membership && page !== "creator" && !upgradeReminderHidden && (membership.status === "expired" || membership.daysLeft <= 3) && <div className={`upgrade-reminder ${membership.status}`} role="status"><span>{membership.status === "expired" ? "Your free trial has ended. Upgrade to keep uploading videos." : `${membership.status === "trial" ? "Free trial" : "Membership"} ends in ${membership.daysLeft} ${membership.daysLeft === 1 ? "day" : "days"}. Upgrade to keep uploading.`}</span><button className="primary-btn" onClick={openCreatorDashboard}>Upgrade</button><button type="button" className="icon-btn" aria-label="Dismiss reminder" onClick={()=>setUpgradeReminderHidden(true)}><X size={16}/></button></div>}
      {error && <div className="notice">{error}<button onClick={() => setError("")}><X size={16}/></button></div>}
      {page === "notifications" && authRole === "admin" && <section className="admin-panel video-review-panel">
        <div className="section-heading"><div><span className="eyebrow"><Film size={14}/> CREATOR & BUSINESS CONTENT</span><h1>Video review</h1><p className="muted">Creator and business uploads stay private until approved. Rejected uploads and their stored video assets are deleted.</p></div></div>
        <div className="notification-section"><h2>Videos awaiting approval {pendingCreatorVideos.length > 0 && <span className="notification-count">{pendingCreatorVideos.length}</span>}</h2>
          {pendingCreatorVideos.length ? <div className="video-review-list">{pendingCreatorVideos.map(video=><article className="video-review-item" key={video.id}>
            <div className="video-review-details"><strong>{video.title}</strong><span>By {video.ownerName} · {video.ownerType} · Submitted {new Date(video.createdAt).toLocaleString()}</span>{video.description && <p>{video.description}</p>}<span className="processing-status pending">{video.processingStatus || "uploaded"}{video.processingStatus !== "ready" && ` · ${Number(video.encodeProgress || 0)}% encoded`}</span>{video.processingStatus === "ready" && video.playbackUrl ? <button className="secondary-btn review-watch-toggle" onClick={()=>setVideoPreviewOpen(current=>({...current,[video.id]:!current[video.id]}))}><Play size={16}/>{videoPreviewOpen[video.id]?"Hide video":"Watch video"}</button> : <span className="muted review-preview-note">Video preview will be available when encoding is complete.</span>}{videoPreviewOpen[video.id] && video.playbackUrl && <div className="review-video-player">{isDirectVideoUrl(video.playbackUrl) ? <video src={video.playbackUrl} title={video.title} controls playsInline/> : <iframe src={video.playbackUrl} title={`Preview ${video.title}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/>}</div>}</div>
            <div className="video-review-controls"><textarea maxLength={500} value={videoRejectionReasons[video.id] || ""} onChange={event=>setVideoRejectionReasons(current=>({...current,[video.id]:event.target.value}))} placeholder="Reason required to reject (max 500 characters)"/><div className="member-review-actions"><button className="primary-btn" onClick={()=>reviewCreatorVideo(video,"approved")}><Check size={16}/> Approve</button><button className="secondary-btn" disabled={!videoRejectionReasons[video.id]?.trim()} onClick={()=>reviewCreatorVideo(video,"rejected")}>Reject & delete</button></div></div>
          </article>)}</div> : <p className="muted">No creator videos awaiting review.</p>}
        </div>
      </section>}
      {page === "creator" && authRole === "creator" && videos.some(video=>video.approvalStatus === "pending") && <section className="admin-panel review-status-panel">
        <div className="membership-status"><Clock3 size={20}/><div><strong>Waiting for approval</strong><span>{videos.filter(video=>video.approvalStatus === "pending").map(video=>video.title).join(", ")} — your submission is private until an admin reviews it. Video encoding status is shown separately in Creator studio.</span></div></div>
      </section>}
      {page === "shorts" ? <Shorts api={API} token={adminToken} role={authRole} onSignIn={openAdmin} initialId={initialShortId} suspended={profileDrawerOpen || membershipPaying}/>
      : selected ? <section className="watch-page">
        <button className="back-link" onClick={closeVideo}>← Back to Explore</button>
        {selected.isBusinessPreview && <div className="membership-status"><Clock3 size={20}/><div><strong>Private business preview</strong><span>This preview is only available to your business account. It is not publicly visible until approved and promoted.</span></div></div>}
        {selected.creatorProfile && <div className="creator-profile">{selected.creatorProfile.profilePhotoUrl ? <img className="creator-avatar" src={apiAssetSrc(selected.creatorProfile.profilePhotoUrl)} alt={`${selected.creatorProfile.displayName}'s profile`}/> : <span className="creator-avatar"><UserRound size={18}/></span>}<span className="creator-profile-details"><small>CREATOR</small><strong>{selected.creatorProfile.displayName || selected.creatorProfile.username}</strong>{selected.creatorProfile.bio && <span className="creator-bio">{selected.creatorProfile.bio}</span>}<span className="creator-follower-count">{(creatorFollowData.creatorId === selected.creatorProfile.id ? creatorFollowData.followerCount : 0).toLocaleString()} followers</span><IntroVideo api={API} url={selected.creatorProfile.introVideoUrl}/></span>{!(creatorFollowData.creatorId === selected.creatorProfile.id && creatorFollowData.isSelf) && authRole !== "business" && <button className={`creator-follow-btn ${creatorFollowData.following ? "following" : ""}`} disabled={creatorFollowLoading || creatorFollowSubmitting || creatorFollowData.creatorId !== selected.creatorProfile.id} onClick={toggleCreatorFollow}><UserPlus size={16}/>{creatorFollowData.following ? "Unfollow" : "Follow"}</button>}</div>}
        <div className="player-wrap" onContextMenu={event=>event.preventDefault()}><span className="player-view-count"><Eye size={15}/> {Number(selected.views || 0).toLocaleString()} views</span><PlayerGate key={selected.id} api={API} token={adminToken}>{selected.playbackUrl ? isDirectVideoUrl(selected.playbackUrl) ? <video src={selected.playbackUrl} title={selected.title} controls controlsList="nodownload noremoteplayback" disablePictureInPicture disableRemotePlayback playsInline/> : <iframe src={selected.playbackUrl} title={selected.title} allow="autoplay; encrypted-media" allowFullScreen/> : <div className="empty-player"><Play size={48}/><p>Add a Bunny Stream player URL in Admin to enable playback.</p></div>}</PlayerGate></div>
        <div className="watch-meta"><div><span className="eyebrow">{selected.category?.name || (selected.isSponsored ? "PROMOTIONAL VIDEO" : "ZINDA PLAY ORIGINAL")}</span><h1>{selected.title}</h1><p>{selected.description}</p><span className="view-count"><Eye size={15}/> {Number(selected.views || 0).toLocaleString()} views</span></div><div className="watch-actions">{selected.promotionUrl && /^https:\/\/\S+$/i.test(selected.promotionUrl) && <a className="primary-btn" href={selected.promotionUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={17}/> Let's Plan</a>}<button className="secondary-btn share-btn" onClick={() => shareVideo(selected)}><Share2 size={17}/> Share video</button></div></div>
        {selected.isBusinessPreview ? null : <section className="video-discussion">
          <div className="discussion-actions">
            <button className={`secondary-btn like-btn ${videoInteractions.liked ? "liked" : ""}`} disabled={likeSubmitting} onClick={toggleVideoLike}><Heart size={17} fill={videoInteractions.liked ? "currentColor" : "none"}/>{videoInteractions.liked ? "Liked" : "Like"} · {videoInteractions.likeCount}</button>
            <span className="muted"><MessageCircle size={16}/> {videoInteractions.commentCount} comments</span>
          </div>
          <h2>Comments</h2>
          {adminToken && ["member", "creator", "promoter"].includes(authRole)
            ? <form className="comment-form" onSubmit={submitVideoComment}><textarea required maxLength={1000} value={commentText} onChange={event=>setCommentText(event.target.value)} placeholder="Add a comment…"/><button className="primary-btn" type="submit" disabled={commentSubmitting || !commentText.trim()}>{commentSubmitting ? "Posting…" : "Post comment"}</button></form>
            : <p className="discussion-signin">Sign in with a member account to like or comment.</p>}
          <div className="comment-list">{videoInteractions.comments.map(comment=><article className="comment-item" key={comment.id}><div className="comment-avatar">{comment.username.slice(0,1).toUpperCase()}</div><div><strong>{comment.username}</strong><time>{new Date(comment.createdAt).toLocaleString()}</time><p>{comment.text}</p></div></article>)}{!videoInteractions.comments.length&&<p className="muted">Be the first to comment.</p>}</div>
        </section>}
      </section>
      : page === "discover" ? <section className="admin-panel discovery-panel">
        <div className="section-heading"><div><span className="eyebrow"><Building2 size={14}/> COMMUNITY</span><h1>Creators & brands</h1><p className="muted">Discover creators, explore their published videos, and learn about brands on Zinda Play.</p></div><button className="secondary-btn" onClick={openDiscover}>Refresh</button></div>
        {discoverLoading && <p className="muted">Loading creators and brands…</p>}
        <section className="notification-section"><h2>Creator profiles</h2><div className="creator-directory">{discoverCreators.map(creator=><article className="creator-directory-card" key={creator.id}>
          {creator.profilePhotoUrl ? <img src={apiAssetSrc(creator.profilePhotoUrl)} alt={`${creator.displayName} profile`}/> : <span className="creator-directory-avatar"><UserRound size={24}/></span>}
          <div><strong>{creator.displayName}</strong><small>@{creator.username}</small><p>{creator.bio || "Creator on Zinda Play."}</p></div>
          <div className="creator-directory-actions"><button className="primary-btn" onClick={()=>openDiscoveredCreator(creator)}>View profile</button>{authRole==="business" && <button className="secondary-btn" onClick={()=>{setSelectedCreatorId(creator.id);openBusiness();}}><UserPlus size={15}/> Select</button>}</div>
        </article>)}</div>{!discoverLoading && !discoverCreators.length && <p className="muted">No approved creator profiles are available yet.</p>}</section>
        <section className="notification-section"><h2>Businesses & brands</h2><div className="creator-directory">{discoverBrands.map(brand=><article className="creator-directory-card" key={brand.id}>
          {brand.logoUrl ? <img src={apiAssetSrc(brand.logoUrl)} alt={`${brand.businessName} logo`}/> : <span className="creator-directory-avatar"><Building2 size={24}/></span>}
          <div><strong>{brand.businessName}</strong><small>@{brand.username}</small><p>{brand.businessAbout || "Business on Zinda Play."}</p></div>
          <div className="creator-directory-actions"><button className="secondary-btn" onClick={()=>{setDiscoverCreatorProfile(null);setDiscoverBrandProfile(brand);}}>View brand</button></div>
        </article>)}</div>{!discoverLoading && !discoverBrands.length && <p className="muted">No business or brand profiles are available yet.</p>}</section>
        {discoverCreatorProfile && <section className="notification-section discovery-detail"><button className="secondary-btn" onClick={()=>setDiscoverCreatorProfile(null)}>Close creator profile</button>
          <div className="creator-detail-heading">{discoverCreatorProfile.profilePhotoUrl ? <img src={apiAssetSrc(discoverCreatorProfile.profilePhotoUrl)} alt={`${discoverCreatorProfile.displayName} profile`}/> : <span className="creator-directory-avatar"><UserRound size={28}/></span>}<div><span className="eyebrow">CREATOR PROFILE</span><h2>{discoverCreatorProfile.displayName}</h2><small>@{discoverCreatorProfile.username} · {Number(discoverCreatorProfile.followerCount || 0).toLocaleString()} followers</small><p>{discoverCreatorProfile.bio || "No bio provided."}</p><IntroVideo api={API} url={discoverCreatorProfile.introVideoUrl}/></div>{authRole==="business" && <button className="primary-btn" onClick={()=>{setSelectedCreatorId(discoverCreatorProfile.id);openBusiness();}}><UserPlus size={16}/> Select creator</button>}{!(discoverCreatorProfile.isSelf || ["business","admin"].includes(authRole)) && <button className={`creator-follow-btn ${discoverCreatorProfile.following ? "following" : ""}`} disabled={discoverFollowSubmitting} onClick={toggleDiscoveredCreatorFollow}><UserPlus size={16}/>{discoverCreatorProfile.following ? "Unfollow" : "Follow"}</button>}</div>
          <h3>Published videos</h3>{discoverCreatorProfile.videos.length ? <div className="video-grid">{discoverCreatorProfile.videos.map((video,index)=><button className="video-card" key={video.id} onClick={()=>watchVideo(video)}><div className="thumbnail">{video.thumbnailUrl ? <img src={apiAssetSrc(video.thumbnailUrl)} alt=""/> : <div className={`thumb-gradient gradient-${index%4}`}><Play size={30} fill="currentColor"/></div>}<span className="play-overlay"><Play size={18} fill="currentColor"/></span></div><div className="video-info"><span className="video-category">{video.category?.name || "Zinda Play"}</span><h3>{video.title}</h3><p>{video.description || "Watch this video on Zinda Play."}</p><span className="video-views"><Eye size={14}/> {Number(video.views || 0).toLocaleString()} views</span></div></button>)}</div> : <p className="muted">This creator has no published videos available in your location.</p>}
        </section>}
        {discoverBrandProfile && <section className="notification-section discovery-detail"><button className="secondary-btn" onClick={()=>setDiscoverBrandProfile(null)}>Close brand profile</button><div className="creator-detail-heading">
          {discoverBrandProfile.logoUrl ? <img src={apiAssetSrc(discoverBrandProfile.logoUrl)} alt={`${discoverBrandProfile.businessName} logo`}/> : <span className="creator-directory-avatar"><Building2 size={28}/></span>}<div><span className="eyebrow">BUSINESS / BRAND</span><h2>{discoverBrandProfile.businessName}</h2><small>@{discoverBrandProfile.username}</small><p>{discoverBrandProfile.businessAbout || "Business on Zinda Play."}</p></div>
        </div></section>}
      </section>
      : page === "my-creator-profile" && adminToken && authRole === "creator" ? <section className="admin-panel my-creator-profile">
        <div className="section-heading"><div><span className="eyebrow"><UserRound size={14}/> CREATOR PROFILE</span><h1>{myCreatorProfile?.displayName || accountProfile.displayName || signedInUsername}</h1><p className="muted">Your public profile and published videos on Zinda Play.</p></div></div>
        <div className="my-creator-profile-actions"><button className="secondary-btn" onClick={openProfile}><Pencil size={16}/> Edit profile</button><button className="secondary-btn" onClick={openDiscover}><Building2 size={16}/> Creators & brands</button><button className="primary-btn" onClick={openCreatorDashboard}><LayoutDashboard size={16}/> Creator studio</button><button className="secondary-btn" onClick={openBrandInvitations}><Bell size={16}/> Brand invitations</button><button className="secondary-btn" onClick={openWallet}><WalletCards size={16}/> Wallet</button><button className="secondary-btn" onClick={logout}><LogOut size={16}/> Sign out</button></div>
        <section className="my-creator-profile-card">
          <div className="my-creator-profile-avatar">{myCreatorProfile?.profilePhotoUrl ? <img src={apiAssetSrc(myCreatorProfile.profilePhotoUrl)} alt={`${myCreatorProfile.displayName}'s profile`}/> : <UserRound size={38}/>}</div>
          <div className="my-creator-profile-copy"><span className="eyebrow">@{myCreatorProfile?.username || signedInUsername}</span><h2>{myCreatorProfile?.displayName || accountProfile.displayName || signedInUsername}</h2><p>{myCreatorProfile?.bio || "Add a bio to tell viewers about yourself."}</p></div>
          <div className="my-creator-profile-stats"><div className="my-creator-profile-count"><strong>{Number(myCreatorProfile?.followerCount || 0).toLocaleString()}</strong><span>followers</span></div><div className="my-creator-profile-count"><strong>{myCreatorProfile?.videos?.length || 0}</strong><span>published videos</span></div></div>
        </section>
        <IntroManager api={API} token={adminToken} url={myCreatorProfile?.introVideoUrl} onChange={introVideoUrl=>setMyCreatorProfile(current=>({...current,introVideoUrl}))}/>
        <section className="my-creator-videos"><div className="section-heading"><div><span className="eyebrow">YOUR LIBRARY</span><h2>Published videos</h2></div></div>
          {myCreatorProfile?.videos?.length ? <div className="video-grid">{myCreatorProfile.videos.map((video,index)=><button className="video-card" key={video.id} onClick={()=>watchVideo(video)}><div className="thumbnail">{video.thumbnailUrl ? <img src={apiAssetSrc(video.thumbnailUrl)} alt=""/> : <div className={`thumb-gradient gradient-${index%4}`}><Play size={32} fill="currentColor"/></div>}<span className="play-overlay"><Play size={18} fill="currentColor"/></span></div><div className="video-info"><span className="video-category">{video.collectionName || video.category?.name || "Zinda Play"}</span><h3>{video.title}</h3><p>{video.description || "Watch this video on Zinda Play."}</p><span className="video-views"><Eye size={14}/> {Number(video.views || 0).toLocaleString()} views</span></div></button>)}</div> : <div className="empty-state"><Film size={32}/><h3>No published videos yet</h3><p>Approved and published videos will appear on your profile.</p><button className="primary-btn" onClick={openCreatorDashboard}><Plus size={16}/> Open Creator studio</button></div>}
        </section>
      </section>
      : page === "profile" && adminToken && ["member", "creator", "promoter"].includes(authRole) ? <section className="admin-panel profile-panel">
        <div className="section-heading"><div><span className="eyebrow"><UserRound size={14}/> ACCOUNT SETTINGS</span><h1>Edit profile</h1><p className="muted">Update the profile information viewers see with your videos.</p></div></div>
        <form className="video-form profile-form" onSubmit={saveProfile}>
          <div className="profile-photo-preview">{profileEditPhotoPreview ? <img src={profileEditPhotoPreview} alt="Selected profile photo preview"/> : accountProfile.profilePhotoUrl ? <img src={apiAssetSrc(accountProfile.profilePhotoUrl)} alt="Current profile"/> : <span><UserRound size={30}/></span>}</div>
          <label>Profile photo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={profileSaving} onChange={event=>setProfileEditPhoto(event.target.files?.[0] || null)}/></label>
          <p className="publish-help">JPEG, PNG, WebP, or GIF. Maximum size: 8 MB. Your photo appears above your videos.</p>
          {profileEditPhoto && <p className="profile-selected-file">{profileEditPhoto.name}</p>}
          <label>Display name<input required minLength={1} maxLength={60} value={accountProfile.displayName} disabled={profileSaving} onChange={event=>setAccountProfile(current=>({...current,displayName:event.target.value}))}/></label>
          <label>Username<input value={signedInUsername} disabled readOnly/><span className="publish-help">Username is used to sign in and cannot be changed here.</span></label>
          <label>Bio<textarea maxLength={300} rows={4} value={accountProfile.bio} disabled={profileSaving} onChange={event=>setAccountProfile(current=>({...current,bio:event.target.value}))} placeholder="Tell viewers a little about yourself"/></label>
          <button className="primary-btn" type="submit" disabled={profileSaving}>{profileSaving ? "Saving profile…" : "Save profile"}</button>
        </form>
      </section>
      : page === "business" && adminToken && authRole === "business" ? <section className="admin-panel business-panel">
        <div className="section-heading"><div><span className="eyebrow"><UserRound size={14}/> BRAND WORKSPACE</span><h1>{businessProfile.businessName || "Business profile"}</h1><p className="muted">Manage your brand profile and invite creators to make videos for your business.</p></div><button className="secondary-btn" onClick={openBusiness}>Refresh</button></div>
        <section className="notification-section"><h2>Business profile</h2><form className="video-form profile-form" onSubmit={saveBusinessProfile}>
          <div className="profile-photo-preview">{profileEditPhotoPreview ? <img src={profileEditPhotoPreview} alt="Selected business logo preview"/> : businessProfile.logoUrl ? <img src={apiAssetSrc(businessProfile.logoUrl)} alt="Business logo"/> : <span><UserRound size={30}/></span>}</div>
          <label>Business logo<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={profileSaving} onChange={event=>setProfileEditPhoto(event.target.files?.[0] || null)}/></label>
          <p className="publish-help">JPEG, PNG, WebP, or GIF, up to 8 MB.</p>
          <label>Business name<input required maxLength={100} value={businessProfile.businessName} disabled={profileSaving} onChange={event=>setBusinessProfile(current=>({...current,businessName:event.target.value}))}/></label>
          <label>About your business<textarea maxLength={1000} rows={4} value={businessProfile.businessAbout} disabled={profileSaving} onChange={event=>setBusinessProfile(current=>({...current,businessAbout:event.target.value}))} placeholder="Tell creators about your business"/></label>
          <button className="primary-btn" type="submit" disabled={profileSaving}>{profileSaving ? "Saving…" : "Save business profile"}</button>
        </form></section>
        <section className="notification-section"><h2>Creator profiles</h2><p className="muted">Browse approved creator profiles, see their public videos, and start a private conversation.</p>
          <div className="creator-directory">{businessCreators.map(creator=><article className="creator-directory-card" key={creator.id}>
            {creator.profilePhotoUrl ? <img src={apiAssetSrc(creator.profilePhotoUrl)} alt={`${creator.displayName} profile`}/> : <span className="creator-directory-avatar"><UserRound size={24}/></span>}
            <div><strong>{creator.displayName}</strong><small>@{creator.username}</small><p>{creator.bio || "Creator on Zinda Play."}</p></div>
            <div className="creator-directory-actions"><button className="secondary-btn" onClick={()=>openCreatorProfile(creator)}>View profile</button><button className="primary-btn" onClick={()=>{setSelectedCreatorId(creator.id);document.getElementById("select-creator")?.scrollIntoView({behavior:"smooth"});}}><UserPlus size={15}/> Select</button></div>
          </article>)}</div>
          {!businessCreators.length && <p className="muted">No approved creators are available yet.</p>}
          {creatorProfileDetail && <article className="creator-detail-card"><button className="icon-btn" aria-label="Close creator profile" onClick={()=>setCreatorProfileDetail(null)}><X size={18}/></button><div className="creator-profile">{creatorProfileDetail.profilePhotoUrl?<img className="creator-avatar" src={apiAssetSrc(creatorProfileDetail.profilePhotoUrl)} alt=""/>:<span className="creator-avatar"><UserRound size={18}/></span>}<span><small>CREATOR PROFILE</small><strong>{creatorProfileDetail.displayName}</strong><span className="creator-bio">{creatorProfileDetail.bio || "No bio provided."}</span></span></div><div className="creator-message-section"><div><UserPlus size={19}/><span><strong>Work with {creatorProfileDetail.displayName}</strong><small>Select this creator and the Zinda Play admin will arrange the invitation.</small></span></div><button className="primary-btn" onClick={()=>{setSelectedCreatorId(creatorProfileDetail.id);document.getElementById("select-creator")?.scrollIntoView({behavior:"smooth"});}}><UserPlus size={16}/> Select creator</button></div><h3>Published videos</h3>{creatorProfileDetail.videos.length?<div className="profile-video-list">{creatorProfileDetail.videos.map(video=><article key={video.id}><strong>{video.title}</strong><p>{video.description}</p><span>{Number(video.views||0).toLocaleString()} views</span></article>)}</div>:<p className="muted">This creator has no published videos yet.</p>}</article>}
        </section>
        <section id="select-creator" className="notification-section"><h2>Select a creator for your business</h2><p className="muted">Choose an approved creator and describe what you need. The Zinda Play admin is notified and will send the creator an invitation.</p>
          <form className="business-invite-form" onSubmit={event=>{event.preventDefault();const creator=businessCreators.find(item=>item.id===selectedCreatorId);if(creator)inviteCreator(creator);}}>
            <label>Creator<select required value={selectedCreatorId} onChange={event=>setSelectedCreatorId(event.target.value)}><option value="">Select a creator</option>{businessCreators.map(creator=><option key={creator.id} value={creator.id}>{creator.displayName} (@{creator.username})</option>)}</select></label>
            {selectedCreatorId && <div className="creator-invite-preview">{(()=>{const creator=businessCreators.find(item=>item.id===selectedCreatorId);return <>{creator?.profilePhotoUrl?<img src={apiAssetSrc(creator.profilePhotoUrl)} alt=""/>:<span className="comment-avatar"><UserRound size={18}/></span>}<div><strong>{creator?.displayName}</strong><span>{creator?.bio || `@${creator?.username}`}</span></div></>;})()}</div>}
            <label>What do you need?<textarea required maxLength={1000} rows={4} value={businessInviteMessage} onChange={event=>setBusinessInviteMessage(event.target.value)} placeholder="Describe the video or collaboration you have in mind"/></label>
            <button className="primary-btn" type="submit" disabled={!selectedCreatorId || !businessInviteMessage.trim()}><UserPlus size={16}/> Select creator</button>
          </form>
          <h2 className="business-invitations-heading">My creator requests</h2>{businessInvitations.length ? <div className="notification-list">{businessInvitations.map(invitation=><article className="notification-item" key={invitation.id}><div><strong>{invitation.creatorDisplayName || invitation.creatorUsername}</strong><p>{invitation.note}</p><time>Sent {new Date(invitation.createdAt).toLocaleString()}</time></div><span className={`status ${invitation.status==="handled"?"published":""}`}>{invitation.status==="handled"?"invitation sent":invitation.status}</span></article>)}</div> : <p className="muted">No creators selected yet.</p>}
        </section>
        <BusinessAds api={API} token={adminToken} categories={categories}/>
        {businessVideos.length > 0 && <section className="notification-section"><h2>Legacy video campaigns</h2><p className="muted">Existing campaign history is retained. Create new ads with the QR flow above.</p>{businessVideos.map(video => <article className="business-video-card" key={video.id}><strong>{video.title}</strong><p>{video.campaign?.status || video.approvalStatus} · {video.campaign?.impressions || 0} / {video.campaign?.targetImpressions || 0} impressions</p>{video.processingStatus === "ready" && <button className="secondary-btn" onClick={() => previewBusinessVideo(video)}>Preview legacy video</button>}</article>)}</section>}
      </section>
      : page === "admin-chat" && adminToken && ["admin","creator"].includes(authRole) ? <section className="admin-panel chat-panel">
        <div className="section-heading"><div><span className="eyebrow"><MessageCircle size={14}/> {authRole==="admin"?"CREATOR CHATS":"ZINDA PLAY"}</span><h1>{authRole==="admin" ? (chatPeer?.name || "Creator chats") : "Chat with Zinda Play"}</h1><p className="muted">{authRole==="admin" ? "Conversations with creators about invitations and collaborations." : "Talk to the admin about invitations and collaborations."}</p></div>{authRole==="admin" && <button className="secondary-btn" onClick={openAdminChats}>Refresh</button>}</div>
        {authRole==="admin" && <div className="brand-invitation-list">{adminChatList.map(chat=><button className="notification-item creator-conversation-card" key={chat.creatorId} onClick={()=>openAdminChat(chat)}><div><strong>{chat.creatorName}</strong><p>{chat.latestMessage}</p><time>{new Date(chat.latestAt).toLocaleString()}</time></div><MessageCircle size={18}/></button>)}{!adminChatList.length && <p className="muted">No conversations yet.</p>}</div>}
        {(authRole==="creator" || chatPeer) && <><div className="chat-message-list">{chatThread.map(message=><article className={`chat-message ${message.senderRole===authRole?"sent":""}`} key={message.id}><strong>{message.senderName}</strong><p>{message.text}</p><time>{new Date(message.createdAt).toLocaleString()}</time></article>)}{!chatThread.length&&<p className="muted">No messages yet.</p>}</div>
        <form className="chat-compose" onSubmit={sendAdminChat}><textarea required maxLength={2000} rows={3} value={chatInput} onChange={event=>setChatInput(event.target.value)} placeholder="Write a message…"/><button className="primary-btn" disabled={!chatInput.trim()}><MessageCircle size={16}/> Send</button></form></>}
      </section>
      : page === "creator-requests" && adminToken && authRole === "admin" ? <section className="admin-panel notification-panel">
        <div className="section-heading"><div><span className="eyebrow"><UserPlus size={14}/> CREATOR OUTREACH</span><h1>Creator requests</h1><p className="muted">Businesses select creators here. Send the creator an invitation or a message.</p></div><button className="secondary-btn" onClick={openCreatorRequests}>Refresh</button></div>
        <section className="notification-section"><h2>Business selections {creatorRequests.filter(item=>item.status==="pending").length > 0 && <span className="notification-count">{creatorRequests.filter(item=>item.status==="pending").length}</span>}</h2>
          {creatorRequests.length ? <div className="notification-list">{creatorRequests.map(request=><article className="notification-item" key={request.id}><div><strong>{request.businessName} → {request.creatorDisplayName}</strong><p>{request.note}</p><time>{new Date(request.createdAt).toLocaleString()}</time></div>{request.status==="pending" ? <div className="member-review-actions"><button className="primary-btn" onClick={()=>{setAdminCreatorId(request.creatorId);setAdminCreatorRequestId(request.id);setAdminCreatorText(`${request.businessName} would like to work with you. ${request.note}`.slice(0,1000));document.getElementById("creator-outreach-form")?.scrollIntoView({behavior:"smooth"});}}>Respond</button><button className="secondary-btn" onClick={()=>dismissCreatorRequest(request)}>Dismiss</button></div> : <span className={`status ${request.status==="handled"?"published":""}`}>{request.status}</span>}</article>)}</div> : <p className="muted">No creator selections yet.</p>}
        </section>
        <section id="creator-outreach-form" className="notification-section"><h2>Invite or message a creator</h2>
          <form className="business-invite-form" onSubmit={event=>event.preventDefault()}>
            <label>Creator<select required value={adminCreatorId} onChange={event=>{setAdminCreatorId(event.target.value);setAdminCreatorRequestId("");}}><option value="">Select a creator</option>{adminCreators.map(creator=><option key={creator.id} value={creator.id}>{creator.displayName} (@{creator.username})</option>)}</select></label>
            <label>Message<textarea required maxLength={1000} rows={4} value={adminCreatorText} onChange={event=>setAdminCreatorText(event.target.value)} placeholder="Write the invitation or message"/></label>
            <div className="member-review-actions"><button className="primary-btn" type="button" disabled={!adminCreatorId || !adminCreatorText.trim()} onClick={()=>sendToCreator("invitation")}><Bell size={16}/> Send invitation</button><button className="secondary-btn" type="button" disabled={!adminCreatorId || !adminCreatorText.trim()} onClick={()=>sendToCreator("message")}><MessageCircle size={16}/> Send message</button></div>
          </form>
        </section>
      </section>
      : page === "invitations" && adminToken && authRole === "creator" ? <section className="admin-panel notification-panel">
        <div className="section-heading"><div><span className="eyebrow"><Bell size={14}/> COLLABORATIONS</span><h1>Brand invitations</h1><p className="muted">Review video invitations from businesses and respond to their brief.</p></div><button className="secondary-btn" onClick={()=>loadCreatorInvitations()}>Refresh</button></div>
        {creatorInvitations.length ? <div className="brand-invitation-list">{creatorInvitations.map(invitation=><article className="brand-invitation-card" key={invitation.id}><div><span className="eyebrow">INVITATION FROM</span><h2>{invitation.businessName}</h2><p>{invitation.message}</p><time>Received {new Date(invitation.createdAt).toLocaleString()}</time></div><div className="brand-invitation-actions">{invitation.status==="pending" ? <><button className="primary-btn" onClick={()=>respondToInvitation(invitation,"accepted")}><Check size={16}/> I'm interested</button><button className="secondary-btn" onClick={()=>respondToInvitation(invitation,"declined")}>Not interested</button></> : <span className={`status ${invitation.status==="accepted"?"published":""}`}>{invitation.status}</span>}</div></article>)}</div> : <div className="empty-state"><Bell size={30}/><h3>No brand invitations yet</h3><p>Invitations from businesses will appear here.</p></div>}
      </section>
      : page === "promoter" && adminToken && authRole === "promoter" ? <section className="admin-panel promoter-panel">
        <div className="section-heading"><div><span className="eyebrow"><WalletCards size={14}/> PROMOTER REWARDS</span><h1>Promoter dashboard</h1><p className="muted">Share your referral link and earn from eligible views. Rewards are reviewed and paid manually by an administrator.</p></div><button className="secondary-btn" onClick={openPromoterDashboard}>Refresh</button></div>
        <div className="promoter-referral-card"><div><span className="eyebrow">YOUR REFERRAL LINK</span><code>{promoterWallet ? referralUrl(promoterWallet.referralCode) : "Loading referral link…"}</code><p>People must create an account through this link before their eligible video watches can count for your referral rewards.</p></div><button className="primary-btn" disabled={!promoterWallet} onClick={()=>shareReferralLink()}><Share2 size={16}/> Share invitation</button><button className="secondary-btn" disabled={!promoterWallet} onClick={()=>copyReferralLink()}>Copy link</button></div>
        <div className="promoter-wallet-stats"><article><span>Available</span><strong>₹{Number(promoterWallet?.availableRupees||0).toLocaleString("en-IN")}</strong></article><article><span>Total earned</span><strong>₹{Number(promoterWallet?.earnedRupees||0).toLocaleString("en-IN")}</strong></article><article><span>Pending payout</span><strong>₹{Number(promoterWallet?.pendingRupees||0).toLocaleString("en-IN")}</strong></article><article><span>Already paid</span><strong>₹{Number(promoterWallet?.paidRupees||0).toLocaleString("en-IN")}</strong></article></div>
        <section className="notification-section promoter-progress-list"><h2>How you earn</h2><article><div><strong>Referral views</strong><span>{Number(promoterWallet?.referredViews||0).toLocaleString("en-IN")} eligible referred views · {Number(promoterWallet?.referralRewardMilestones||0)} rewards earned</span></div><div className="promoter-progress-track"><span style={{width:`${Number(promoterWallet?.referredViews||0)%1000/10}%`}}/></div><small>{Number(promoterWallet?.referralViewsUntilReward??1000).toLocaleString("en-IN")} more eligible views for the next ₹20</small></article><article><div><strong>Videos watched</strong><span>{Number(promoterWallet?.distinctVideosWatched||0).toLocaleString("en-IN")} distinct published videos · {Number(promoterWallet?.watchRewardMilestones||0)} rewards earned</span></div><div className="promoter-progress-track"><span style={{width:`${Number(promoterWallet?.distinctVideosWatched||0)%100}%`}}/></div><small>{Number(promoterWallet?.videosUntilWatchReward??100).toLocaleString("en-IN")} more distinct videos for the next ₹10</small></article><p className="wallet-note">Eligible watches require a signed-in account and a visible video page for at least 30 seconds (or the full duration if it is shorter). Each viewer counts once per video; promoters earn ₹20 per 1,000 eligible referred views and ₹10 per 100 distinct videos they watch.</p></section>
        <section className="notification-section"><h2>Request a payout</h2><p className="muted">Request payout to your UPI ID or UPI-linked 10-digit mobile number when at least ₹100 is available. An admin will manually review and pay approved requests.</p><form className="business-invite-form" onSubmit={requestPromoterWithdrawal}><label>UPI ID or UPI-linked mobile number<input required maxLength={100} value={promoterPayoutHandle} onChange={event=>setPromoterPayoutHandle(event.target.value)} placeholder="name@bank or 9876543210"/></label><button className="primary-btn" type="submit" disabled={Number(promoterWallet?.availableRupees||0)<100 || promoterWallet?.withdrawals?.some(item=>item.status==="pending")}>Request available balance</button></form></section>
        <section className="notification-section"><h2>Withdrawal history</h2>{promoterWallet?.withdrawals?.length ? <div className="wallet-video-analytics">{promoterWallet.withdrawals.map(withdrawal=><article className="wallet-video-row" key={withdrawal.id}><div className="wallet-video-heading"><strong>₹{Number(withdrawal.amountRupees).toLocaleString("en-IN")} · {withdrawal.payoutHandle}</strong><span className={`status ${withdrawal.status==="paid"?"published":""}`}>{withdrawal.status}</span></div><div className="wallet-video-metrics"><span>Requested {new Date(withdrawal.createdAt).toLocaleString()}</span>{withdrawal.rejectionReason&&<span>Reason: {withdrawal.rejectionReason}</span>}</div></article>)}</div>:<p className="muted">No payout requests yet.</p>}</section>
      </section>
      : page === "wallet" && adminToken && authRole === "creator" ? <section className="admin-panel wallet-panel">
        <div className="section-heading"><div><span className="eyebrow"><WalletCards size={14}/> CREATOR WALLET</span><h1>Your earnings</h1><p className="muted">Earnings use unique viewer IPs, counted once per video.</p></div><button className="secondary-btn" onClick={openWallet}>Refresh</button></div>
        <div className="wallet-summary"><div className="wallet-summary-icon"><WalletCards size={24}/></div><span>Estimated earnings</span><strong>₹{Number(wallet?.estimatedEarningsRupees || 0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
        <div className="wallet-analytics-stats"><div><span>All recorded plays</span><strong>{Number(wallet?.totalViews || 0).toLocaleString("en-IN")}</strong></div><div><span>Unique earning views</span><strong>{Number(wallet?.eligibleViews || 0).toLocaleString("en-IN")}</strong></div><div><span>Videos earning</span><strong>{wallet?.videos.filter(video=>video.eligibleViews>0).length || 0}</strong></div></div>
        <p className="wallet-note">Regular videos: ₹{wallet?.rateRupees ?? 50} per {Number(wallet?.rateViews ?? 1000).toLocaleString("en-IN")} qualifying views.{wallet?.simplyRateRupees != null && <> Simply: ₹{wallet.simplyRateRupees} per {Number(wallet.simplyRateViews).toLocaleString("en-IN")} qualifying views, earned proportionally from new qualifying views only. Earlier Simply views are not credited retroactively. Previously earned regular-view amounts are retained. Amounts are rounded for display.</>}</p>
        {wallet?.creatorAdRateRupees != null && <p className="wallet-note">Creator ads: regular-video ads ₹{wallet.creatorAdRateRupees}, Simply ads ₹{wallet.simplyAdRateRupees} per {Number(wallet.adRateViews).toLocaleString("en-IN")} full watches. Each viewer earns once per ad; skipped ads do not earn. Ad earnings: ₹{Number(wallet.adEstimatedEarningsRupees || 0).toFixed(2)} from {wallet.adEligibleViews || 0} full watches. Deleted videos retain earned credit.</p>}
        <section className="notification-section"><h2>Per-video earnings analytics</h2>{wallet?.videos.length ? <div className="wallet-video-analytics">{wallet.videos.map(video=><article className="wallet-video-row" key={video.id}><div className="wallet-video-heading"><strong>{video.deleted ? "Deleted · " : ""}{video.videoType === "short" ? "Simply · " : ""}{video.title}</strong><span>₹{Number(video.totalEstimatedEarningsRupees ?? video.estimatedEarningsRupees).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2})} earned</span></div><div className="wallet-video-metrics"><span>{Number(video.eligibleViews).toLocaleString("en-IN")} unique earning views</span><span>{Number(video.totalViews).toLocaleString("en-IN")} total plays</span>{video.adEligibleViews > 0 && <span>{video.adEligibleViews} full ad watches · ₹{Number(video.adEstimatedEarningsRupees).toFixed(2)} ad earnings</span>}</div></article>)}</div> : <p className="muted">Upload and publish a video to start earning view-based estimates.</p>}</section>
      </section>
      : page === "notifications" && adminToken && ["admin", "member", "creator", "business", "promoter"].includes(authRole) ? <section className="admin-panel notification-panel"><div className="section-heading"><div><span className="eyebrow"><Bell size={14}/> ACCOUNT UPDATES</span><h1>Notifications</h1><p className="muted">{authRole === "admin" ? "Review creator applications, promoter payouts, and account updates." : authRole === "business" ? "Creator invitation responses and business account updates." : authRole === "promoter" ? "Referral and promoter reward updates." : "Membership approvals and updates for your creator account."}</p></div><button className="secondary-btn" onClick={()=>loadNotifications()}>Refresh</button></div>{authRole === "member" && <div className="membership-status"><Clock3 size={20}/><div><strong>Creator membership pending</strong><span>An administrator will review your request. We’ll notify you here when it’s approved.</span></div></div>}{authRole === "creator" && <div className="membership-status approved"><Check size={20}/><div><strong>Creator membership approved</strong><span>You can upload videos and see their view analytics in Creator studio.</span></div></div>}{authRole === "admin" && <section className="notification-section"><h2>Creator applications {pendingMembers.length > 0 && <span className="notification-count">{pendingMembers.length}</span>}</h2>{pendingMembers.length ? <div className="member-application-list">{pendingMembers.map(member=><article className="member-application" key={member.id}><div><strong>{member.username}</strong><span>Requested {new Date(member.createdAt).toLocaleDateString()}</span></div><div className="member-review-actions"><button className="primary-btn" onClick={()=>updateMemberDecision(member,"approved")}><Check size={16}/> Approve</button><button className="secondary-btn" onClick={()=>updateMemberDecision(member,"rejected")}>Decline</button></div></article>)}</div> : <p className="muted">No creator applications awaiting review.</p>}</section>}{authRole === "admin" && <section className="notification-section"><h2>Promoter withdrawals {pendingPromoterWithdrawals.length > 0 && <span className="notification-count">{pendingPromoterWithdrawals.length}</span>}</h2>{pendingPromoterWithdrawals.length ? <div className="member-application-list">{pendingPromoterWithdrawals.map(withdrawal=><article className="member-application promoter-withdrawal-item" key={withdrawal.id}><div><strong>{withdrawal.username} · ₹{Number(withdrawal.amountRupees).toLocaleString("en-IN")}</strong><span>Pay to UPI: <strong>{withdrawal.payoutHandle}</strong></span><span>Requested {new Date(withdrawal.createdAt).toLocaleString()}</span><textarea maxLength={500} value={withdrawalRejectionReasons[withdrawal.id]||""} onChange={event=>setWithdrawalRejectionReasons(current=>({...current,[withdrawal.id]:event.target.value}))} placeholder="Reason required to reject"/></div><div className="member-review-actions"><button className="primary-btn" onClick={()=>reviewPromoterWithdrawal(withdrawal,"paid")}><Check size={16}/> Mark paid</button><button className="secondary-btn" disabled={!withdrawalRejectionReasons[withdrawal.id]?.trim()} onClick={()=>reviewPromoterWithdrawal(withdrawal,"rejected")}>Reject</button></div></article>)}</div> : <p className="muted">No promoter withdrawals awaiting review.</p>}</section>}<section className="notification-section"><h2>Recent updates</h2>{notifications.length ? <div className="notification-list">{notifications.map(notification=><article className={`notification-item ${notification.readAt ? "" : "unread"}`} key={notification.id}><div><strong>{notification.title}</strong><p>{notification.message}</p><time>{new Date(notification.createdAt).toLocaleString()}</time></div>{!notification.readAt && <button className="secondary-btn" onClick={()=>markNotificationRead(notification)}>Mark read</button>}{authRole === "creator" && notification.type === "brand_invitation" && creatorInvitations.find(item=>item.id===notification.invitationId && item.status==="pending") && <div className="member-review-actions"><button className="primary-btn" onClick={()=>respondToInvitation(creatorInvitations.find(item=>item.id===notification.invitationId),"accepted")}><Check size={16}/> I'm interested</button><button className="secondary-btn" onClick={()=>respondToInvitation(creatorInvitations.find(item=>item.id===notification.invitationId),"declined")}>Not interested</button></div>}{authRole === "creator" && notification.type === "admin_message" && <button className="secondary-btn" onClick={()=>openAdminChat()}><MessageCircle size={16}/> Reply</button>}{authRole === "admin" && notification.type === "creator_chat" && <button className="secondary-btn" onClick={()=>openAdminChat({creatorId:notification.creatorId,creatorName:notification.title.replace("Message from creator ","")})}><MessageCircle size={16}/> Open chat</button>}</article>)}</div> : <p className="muted">No notifications yet.</p>}</section></section>
      : page === "creator" && adminToken && authRole === "creator" ? <section className="admin-panel">{!accountProfile.profilePhotoUrl && <div className="membership-banner expired"><div><strong>Profile photo required</strong><span>Creators must have a profile photo before uploading videos.</span></div><button className="primary-btn" onClick={openProfile}><Pencil size={16}/> Add profile photo</button></div>}{membership && <div className={`membership-banner ${membership.status}`}><div><strong>{membership.status === "trial" ? `Free trial · ${membership.daysLeft} ${membership.daysLeft === 1 ? "day" : "days"} left` : membership.status === "active" ? `Membership active · ${membership.daysLeft} ${membership.daysLeft === 1 ? "day" : "days"} left` : "Free trial ended"}</strong><span>{membership.status === "expired" ? `Subscribe for ₹${membership.priceRupees} per ${membership.periodDays} days to keep uploading videos.` : membership.status === "trial" ? `After the trial, membership is ₹${membership.priceRupees} per ${membership.periodDays} days.` : `Renews by payment for ₹${membership.priceRupees} per ${membership.periodDays} days.`}</span></div>{membership.status !== "active" && <button className="primary-btn" disabled={membershipPaying} onClick={subscribeMembership}><WalletCards size={16}/> {membershipPaying ? "Opening…" : `Subscribe · ₹${membership.priceRupees}`}</button>}</div>}<div className="section-heading"><div><span className="eyebrow">CREATOR STUDIO</span><h1>Your video library</h1><p className="muted">Upload your videos and follow their publishing and view performance.</p></div><div className="admin-actions"><button className="secondary-btn" onClick={()=>setPage("creator-analytics")}><BarChart3 size={16}/> Analytics</button><button className="primary-btn" disabled={membership?.status==="expired" || !accountProfile.profilePhotoUrl} title={!accountProfile.profilePhotoUrl?"Add a profile photo first":membership?.status==="expired"?"Subscribe to keep uploading":undefined} onClick={()=>{setForm(blank);setEditingId(null);setThumbnailFile(null);setUploadFile(null);setPage("add");}}><Plus size={17}/> Upload video</button></div></div>      {creatorReferrals && <div className="promoter-referral-card"><div><span className="eyebrow">INVITE PEOPLE · YOUR REFERRAL LINK</span><code>{referralUrl(creatorReferrals.referralCode)}</code><p>{Number(creatorReferrals.total).toLocaleString()} {creatorReferrals.total===1?"person has":"people have"} joined through your link.{creatorReferrals.referred.length>0 && ` Latest: ${creatorReferrals.referred.slice(0,3).map(person=>person.username).join(", ")}.`}</p></div><button className="primary-btn" onClick={()=>shareReferralLink(creatorReferrals.referralCode)}><Share2 size={16}/> Share invitation</button><button className="secondary-btn" onClick={()=>copyReferralLink(creatorReferrals.referralCode)}>Copy link</button></div>}
      <div className="stats-grid"><div className="stat-card"><Film/><span>Your videos</span><strong>{creatorStats?.totalVideos ?? videos.length}</strong></div><div className="stat-card"><Play/><span>Published</span><strong>{creatorStats?.publishedVideos ?? videos.filter(video=>video.published).length}</strong></div><div className="stat-card"><Eye/><span>Total views</span><strong>{Number(creatorStats?.totalViews || 0).toLocaleString()}</strong></div></div><div className="table-wrap"><table><thead><tr><th>Video</th><th>Publish</th><th>Processing</th><th>Views</th><th>Actions</th></tr></thead><tbody>{videos.map(video=><tr key={video.id}><td><div className="table-title">{video.thumbnailUrl?<img src={apiAssetSrc(video.thumbnailUrl)} alt=""/>:<div className="mini-thumb"><Film size={17}/></div>}<span>{video.title}{video.collectionName && <small className="table-collection-label">{video.collectionName} · {video.collectionType==="series"?"Episode":"Item"}{video.episodeNumber ? ` ${video.episodeNumber}` : ""}</small>}</span></div></td><td><span className={video.published?"status published":"status"}>{video.published?"Published":"Unpublished"}</span></td><td>{video.processingStatus ? <div className="processing-cell"><span className={`processing-status ${video.processingStatus==="ready"?"ready":video.processingStatus==="error"||video.processingStatus==="upload failed"?"failed":"pending"}`}>{video.processingStatus}</span>{video.processingStatus!=="ready"&&video.processingStatus!=="error"&&video.processingStatus!=="upload failed"&&<span className="processing-progress">{Number(video.encodeProgress||0)}% encoded</span>}</div> : <span className="muted">Ready</span>}</td><td><span className="table-views"><Eye size={14}/> {Number(video.views||0).toLocaleString()}</span></td><td><button className="icon-btn" title="Edit video" aria-label={`Edit ${video.title}`} onClick={()=>editVideo(video)}><Pencil size={16}/></button><button className="icon-btn danger" title="Delete video" aria-label={`Delete ${video.title}`} onClick={()=>deleteVideo(video.id)}><Trash2 size={16}/></button></td></tr>)}</tbody></table>{!videos.length&&<p className="muted empty-state">No videos yet. Upload your first video to start building your library.</p>}</div></section>
      : page === "creator-analytics" && adminToken && authRole === "creator" ? <section className="admin-panel"><button className="back-link" onClick={()=>setPage("creator")}>← Back to Creator studio</button><div className="section-heading"><div><span className="eyebrow"><BarChart3 size={14}/> VIDEO PERFORMANCE</span><h1>Your analytics</h1><p className="muted">View counts for videos in your creator library.</p></div></div><div className="analytics-stats"><div className="analytics-card"><Eye/><span>Total views</span><strong>{Number(creatorStats?.totalViews||0).toLocaleString()}</strong></div><div className="analytics-card"><Film/><span>Total videos</span><strong>{Number(creatorStats?.totalVideos||0).toLocaleString()}</strong></div><div className="analytics-card"><Play/><span>Published</span><strong>{Number(creatorStats?.publishedVideos||0).toLocaleString()}</strong></div><div className="analytics-card"><Sparkles/><span>Average views</span><strong>{creatorStats?.totalVideos ? Math.round(creatorStats.totalViews/creatorStats.totalVideos).toLocaleString() : "0"}</strong></div></div><section className="analytics-section"><h2><BarChart3 size={18}/> Video views</h2>{creatorStats?.videos.length ? <div className="ranking-list">{creatorStats.videos.map((video,index)=><div className="ranking-item" key={video.id}><span className="ranking-number">{index+1}</span><div className="ranking-content"><div className="ranking-label"><strong>{video.title}</strong><span>{Number(video.views||0).toLocaleString()} views</span></div><div className="ranking-track"><span style={{width:`${creatorStats.videos[0].views ? Math.max(3,Number(video.views||0)/Number(creatorStats.videos[0].views)*100) : 0}%`}}/></div></div></div>)}</div> : <p className="muted">Upload a video to see its analytics here.</p>}</section></section>
      : page === "analytics" && adminToken && authRole === "admin" ? <section className="admin-panel"><button className="back-link" onClick={() => setPage("admin")}>← Back to Admin</button><div className="section-heading"><div><span className="eyebrow"><BarChart3 size={14}/> PERFORMANCE</span><h1>Content analytics</h1><p className="muted">View counts for your video library since tracking began.</p></div></div><div className="analytics-stats"><div className="analytics-card"><Eye/><span>Total views</span><strong>{analytics.totalViews.toLocaleString()}</strong></div><div className="analytics-card"><Film/><span>Total content</span><strong>{videos.length.toLocaleString()}</strong></div><div className="analytics-card"><Play/><span>Published</span><strong>{videos.filter(video=>video.published).length.toLocaleString()}</strong></div><div className="analytics-card"><Sparkles/><span>Average views</span><strong>{videos.length ? Math.round(analytics.totalViews/videos.length).toLocaleString() : "0"}</strong></div></div><div className="analytics-columns"><section className="analytics-section"><h2><BarChart3 size={18}/> Top videos</h2>{analytics.topVideos.length ? <div className="ranking-list">{analytics.topVideos.slice(0,10).map((video,index)=><div className="ranking-item" key={video.id}><span className="ranking-number">{index+1}</span><div className="ranking-content"><div className="ranking-label"><strong>{video.title}</strong><span>{Number(video.views||0).toLocaleString()} views</span></div><div className="ranking-track"><span style={{width:`${analytics.topVideos[0].views ? Math.max(3,Number(video.views||0)/Number(analytics.topVideos[0].views)*100) : 0}%`}}/></div></div></div>)}</div> : <p className="muted">No videos to report yet.</p>}</section><section className="analytics-section"><h2><Tags size={18}/> Category performance</h2>{analytics.categoryStats.length ? <div className="category-analytics">{analytics.categoryStats.map(category=><div className="category-analytics-item" key={category.id}><div><strong>{category.name}</strong><span>{category.videos} {category.videos===1?"video":"videos"}</span></div><b><Eye size={14}/> {category.views.toLocaleString()}</b></div>)}</div> : <p className="muted">No categories to report yet.</p>}</section></div><p className="analytics-note">Views are counted when a published video is opened. Analytics are currently held in memory and reset when the API restarts.</p></section>
      : page === "categories" && adminToken && authRole === "admin" ? <section className="admin-panel"><button className="back-link" onClick={() => {setPage(returnToContent ? "add" : "admin");setReturnToContent(false);}}>← Back to {returnToContent ? "Content" : "Admin"}</button><div className="section-heading"><div><span className="eyebrow">CONTENT ORGANIZATION</span><h1>Categories</h1><p className="muted">Create categories to organize your video library.</p></div></div><form className="category-form" onSubmit={createCategory}><label>Category name<input required maxLength={60} value={categoryName} onChange={e=>setCategoryName(e.target.value)} placeholder="e.g. Tutorials"/></label><button className="primary-btn" type="submit"><Plus size={17}/> Create category</button></form><div className="category-list">{categories.map(category=><div className="category-list-item" key={category.id}><Tags size={17}/><span>{category.name}</span></div>)}</div></section>
      : page === "membership-admin" && adminToken && authRole === "admin" ? <AdminMembership api={API} token={adminToken} onBack={()=>setPage("admin")}/>
      : page === "ads" && adminToken && authRole === "admin" ? <AdminAds api={API} token={adminToken} onBack={()=>setPage("admin")} onUnauthorized={()=>{clearAdminSession();setPage("admin");}}/>
      : page === "banner" && adminToken && authRole === "admin" ? <section className="admin-panel">
        <button className="back-link" onClick={() => setPage("admin")}>← Back to Admin</button>
        <div className="section-heading"><div><span className="eyebrow"><Sparkles size={14}/> HOMEPAGE PROMOTION</span><h1>Banner settings</h1><p className="muted">Manage the promotional banner shown on the homepage.</p></div></div>
        <form className="video-form banner-form" onSubmit={saveBanner}>
          <div className="checks"><label><input type="checkbox" checked={bannerForm.enabled} onChange={e=>setBannerForm({...bannerForm,enabled:e.target.checked})}/> Show banner on homepage</label></div>
          <label>Banner title<input required={bannerForm.enabled} maxLength={120} value={bannerForm.title} onChange={e=>setBannerForm({...bannerForm,title:e.target.value})} placeholder="e.g. Discover something new"/></label>
          <label>Description<textarea maxLength={500} value={bannerForm.description} onChange={e=>setBannerForm({...bannerForm,description:e.target.value})} placeholder="A short message for your viewers"/></label>
          <div className="upload-field banner-upload-field">
            <label>Upload banner image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={bannerImageUploading} onChange={e=>{setBannerImageFile(e.target.files?.[0] || null);setBannerImageProgress(0);}}/></label>
            <p>Recommended test image: 1200 x 400 pixels (3:1) for web and mobile. The full image is shown without cropping; title, description and button appear below it. Use large, readable artwork text. Other sizes are fitted with padding.</p>
            <p>JPEG, PNG, WebP, or GIF. Maximum size: 8 MB. Images are stored in MongoDB.</p>
            {bannerForm.imageUrl && <img className="banner-image-preview" src={apiAssetSrc(bannerForm.imageUrl)} alt="Current homepage banner"/>}
            {bannerImageFile && <div className="upload-progress"><div><span>{bannerImageFile.name}</span><strong>{bannerImageUploading ? `${bannerImageProgress}% uploaded` : "Ready to upload"}</strong></div><progress max="100" value={bannerImageProgress}/><button className="secondary-btn" type="button" disabled={bannerImageUploading} onClick={saveBannerImage}><Upload size={16}/>{bannerImageUploading ? "Uploading…" : "Upload image"}</button></div>}
          </div>
          <label>Button label<input maxLength={40} value={bannerForm.buttonLabel} onChange={e=>setBannerForm({...bannerForm,buttonLabel:e.target.value})} placeholder="Watch now"/></label>
          <label>Button link<input type="url" value={bannerForm.buttonUrl} onChange={e=>setBannerForm({...bannerForm,buttonUrl:e.target.value})} placeholder="https://..."/></label>
            <p className="publish-help">Add both a button label and a link, or leave both empty. Banner text and the uploaded image are stored in MongoDB.</p>
            <button className="primary-btn" type="submit" disabled={bannerImageUploading}><Sparkles size={17}/> Save banner</button>
        </form>
      </section>
      : page === "add" && adminToken && ["admin", "creator"].includes(authRole) ? <section className="admin-panel">
        <button className="back-link" onClick={() => {setPage(authRole === "creator" ? "creator" : "admin");setEditingId(null);setUploadFile(null);setThumbnailFile(null);}}>← Back to {authRole === "creator" ? "Creator studio" : "Admin"}</button>
        <div className="section-heading"><div><span className="eyebrow">{authRole === "creator" ? "CREATOR STUDIO" : "CONTENT STUDIO"}</span><h1>{editingId ? "Edit video" : authRole === "creator" ? "Upload a video" : "Add a video"}</h1></div></div>
        <form className="video-form" onSubmit={saveVideo}>
          <label>Video title<input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="e.g. Introduction to Zinda Play"/></label>
          <label>Description<textarea value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Tell viewers about this video"/></label>
          <label>Category<select value={form.categoryId} onChange={e=>setForm({...form,categoryId:e.target.value})}>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>{authRole === "admin" && <button className="inline-category-btn" type="button" onClick={()=>{setReturnToContent(true);setPage("categories");}}><Plus size={14}/> Create category</button>}</label>
          <div className="upload-field collection-fields">
            <strong className="upload-field-heading">Add to a collection (optional)</strong>
            <label>Collection name<input list="video-collection-names" maxLength={120} value={form.collectionName} disabled={uploading} onChange={event=>setForm({...form,collectionName:event.target.value})} placeholder="e.g. The First Season"/></label>
            <datalist id="video-collection-names">{[...new Set(videos.filter(video=>video.collectionName).map(video=>video.collectionName))].map(name=><option key={name} value={name}/>)}</datalist>
            <div className="collection-fields-row">
              <label>Collection type<select value={form.collectionType} disabled={uploading} onChange={event=>setForm({...form,collectionType:event.target.value})}><option value="series">Web series</option><option value="playlist">Playlist</option></select></label>
              <label>{form.collectionType==="series"?"Episode number":"Playlist position"}<input type="number" min="1" max="99999" step="1" value={form.episodeNumber} disabled={uploading || !form.collectionName.trim()} onChange={event=>setForm({...form,episodeNumber:event.target.value})} placeholder="Optional"/></label>
            </div>
            <p>Use the same collection name and type on each video to group them. Viewers can browse episodes or playlist videos in order.</p>
          </div>
          <div className="upload-field">
            <label>Limit visibility to a city or town (optional)<input maxLength={100} value={form.targetCity} disabled={uploading} onChange={event=>setForm({...form,targetCity:event.target.value})} placeholder="e.g. Mannarkkad"/></label>
            <p>Leave blank to show this video everywhere. A city target requires a configured MaxMind GeoLite2 City database and matches viewers by IP location; IP-based location can be approximate.</p>
          </div>
          {!editingId && <div className="upload-field">
            <label>{authRole === "creator" ? "Video file (required)" : "Upload video file to Bunny Stream"}<input type="file" required={authRole === "creator"} accept="video/mp4,video/quicktime,video/webm,video/x-matroska,video/x-msvideo,video/x-ms-wmv,video/mpeg,video/3gpp,video/x-m4v" disabled={uploading} onChange={e=>{setUploadFile(e.target.files?.[0] || null);setUploadProgress(0);}}/></label>
            <p>Supported video formats, up to 2 GB. Uploads are published after processing; encoding status will be shown in your studio.</p>
            {uploadFile && <div className="upload-progress"><div><span>{uploadFile.name}</span><strong>{uploading ? `${uploadProgress}% uploaded` : "Ready to upload"}</strong></div><progress max="100" value={uploadProgress}/></div>}
          </div>}
          {authRole === "creator" && <div className="upload-field">
            <strong className="upload-field-heading">Product / service / course link</strong>
            <label>Link type<select value={form.promotionType} disabled={uploading} onChange={e=>setForm({...form,promotionType:e.target.value})}><option value="product">Product</option><option value="service">Service</option><option value="course">Course</option></select></label>
            <label>Link URL (optional)<input type="url" maxLength={2048} value={form.promotionUrl} disabled={uploading} onChange={e=>setForm({...form,promotionUrl:e.target.value})} placeholder="https://..."/></label>
            <p>Add an HTTPS link viewers can open from your video. The video itself must be uploaded as a file.</p>
          </div>}
          {authRole === "creator" && editingId && videos.find(video => video.id === editingId)?.bunnyVideoId && <p className="publish-help">This video is hosted on Bunny Stream. You can edit its title, description, category, product link, target city, and thumbnail here.</p>}
          <div className="upload-field">
            <label>Upload video thumbnail<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading} onChange={e=>{setThumbnailFile(e.target.files?.[0] || null);setUploadProgress(0);}}/></label>
            <p>JPEG, PNG, WebP, or GIF. Maximum size: 8 MB. The thumbnail is saved with the video in MongoDB.</p>
            {form.thumbnailUrl && <img className="thumbnail-preview" src={apiAssetSrc(form.thumbnailUrl)} alt="Current video thumbnail"/>}
            {thumbnailFile && <div className="upload-progress"><div><span>{thumbnailFile.name}</span><strong>{uploading ? `${uploadProgress}% uploaded` : "Ready to upload on save"}</strong></div><progress max="100" value={uploadProgress}/></div>}
          </div>
          {authRole === "admin" && <><label>Bunny Stream player/embed URL<input type="url" value={form.playbackUrl} onChange={e=>setForm({...form,playbackUrl:e.target.value})} placeholder="https://..."/></label><div className="checks"><label><input type="checkbox" checked={form.featured} onChange={e=>setForm({...form,featured:e.target.checked})}/> Featured</label><label><input type="checkbox" checked={form.published} onChange={e=>setForm({...form,published:e.target.checked})}/> Published</label></div><div className="publish-help">{form.published ? "This video will be published when encoding is complete." : "This video will remain unpublished until you publish it."}</div></>}
          <button className="primary-btn" type="submit" disabled={uploading}>{uploading ? uploadFile ? <><Upload size={17}/> Uploading {uploadProgress}%</> : "Saving video…" : editingId ? <><Pencil size={17}/> Save changes</> : uploadFile ? <><Upload size={17}/> Upload video</> : <><Plus size={17}/> Save video</>}</button>
        </form>
      </section>
      : page === "admin" && adminToken && authRole === "admin" ? <section className="admin-panel">
        <AdminShortReports api={API} token={adminToken} videos={videos} onUpdated={() => loadAdmin()}/>
        <div className="section-heading"><div><span className="eyebrow">CONTROL CENTER</span><h1>Content dashboard</h1><p className="muted">Manage your Zinda Play video library.</p></div><div className="admin-actions"><button className="secondary-btn" onClick={()=>setPage("analytics")}><BarChart3 size={16}/> Analytics</button><button className="secondary-btn" onClick={()=>setPage("banner")}><Sparkles size={16}/> Banner</button><button className="secondary-btn" onClick={()=>setPage("ads")}><TrendingUp size={16}/> Ads</button><button className="secondary-btn" onClick={openCreatorRequests}><UserPlus size={16}/> Creator requests</button><button className="secondary-btn" onClick={openAdminChats}><MessageCircle size={16}/> Creator chats</button><button className="secondary-btn" onClick={()=>{setReturnToContent(false);setPage("categories");}}><Tags size={16}/> Categories</button><button className="primary-btn" onClick={()=>{setForm(blank);setEditingId(null);setThumbnailFile(null);setUploadFile(null);setPage("add");}}><Plus size={17}/> Add video</button><button className="secondary-btn" onClick={logout}><LogOut size={16}/> Sign out</button></div></div>
        <div className="stats-grid"><div className="stat-card"><Film/><span>Total videos</span><strong>{videos.length}</strong></div><div className="stat-card"><Sparkles/><span>Featured</span><strong>{videos.filter(v=>v.featured).length}</strong></div><div className="stat-card"><Play/><span>Published</span><strong>{videos.filter(v=>v.published).length}</strong></div></div>
        {videos.some(video=>video.approvalStatus==="pending") && <section className="notification-section admin-video-review"><h2>Creator and business videos awaiting approval <span className="notification-count">{videos.filter(video=>video.approvalStatus==="pending").length}</span></h2><div className="video-review-list">{videos.filter(video=>video.approvalStatus==="pending").map(video=><article className="video-review-item" key={video.id}><div className="video-review-details"><strong>{video.title}</strong><span>{video.ownerType==="business"?"Business video":"Creator video"} · Submitted {new Date(video.createdAt).toLocaleString()}</span>{video.description && <p>{video.description}</p>}<span className="processing-status pending">{video.processingStatus || "uploaded"}{video.processingStatus!=="ready" && ` · ${Number(video.encodeProgress||0)}% encoded`}</span>{video.processingStatus==="ready" && video.playbackUrl ? <button className="secondary-btn review-watch-toggle" onClick={()=>setVideoPreviewOpen(current=>({...current,[video.id]:!current[video.id]}))}><Play size={16}/>{videoPreviewOpen[video.id]?"Hide video":"Watch video"}</button> : <span className="muted review-preview-note">Video preview will be available when encoding is complete.</span>}{videoPreviewOpen[video.id] && video.playbackUrl && <div className="review-video-player">{isDirectVideoUrl(video.playbackUrl) ? <video src={video.playbackUrl} title={video.title} controls playsInline/> : <iframe src={video.playbackUrl} title={`Preview ${video.title}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen/>}</div>}</div><div className="video-review-controls"><textarea maxLength={500} value={videoRejectionReasons[video.id]||""} onChange={event=>setVideoRejectionReasons(current=>({...current,[video.id]:event.target.value}))} placeholder="Reason required to reject (max 500 characters)"/><div className="member-review-actions"><button className="primary-btn" onClick={()=>reviewCreatorVideo(video,"approved")}><Check size={16}/>{video.ownerType==="business"?"Approve for promotion":"Approve & publish"}</button><button className="secondary-btn" disabled={!videoRejectionReasons[video.id]?.trim()} onClick={()=>reviewCreatorVideo(video,"rejected")}>Reject & delete</button></div></div></article>)}</div></section>}
        <div className="table-wrap"><table><thead><tr><th>Video</th><th>Category</th><th>Publish</th><th>Processing</th><th>Views</th><th>Actions</th></tr></thead><tbody>{videos.map(v=><tr key={v.id}>
          <td><div className="table-title">{v.thumbnailUrl?<img src={apiAssetSrc(v.thumbnailUrl)} alt=""/>:<div className="mini-thumb"><Film size={17}/></div>}<span>{v.title}{v.collectionName && <small className="table-collection-label">{v.collectionName} · {v.collectionType==="series"?"Episode":"Item"}{v.episodeNumber ? ` ${v.episodeNumber}` : ""}</small>}</span></div></td>
          <td>{v.category?.name || "—"}</td>
          <td><span className={v.approvalStatus==="pending"?"status":v.published?"status published":"status"}>{v.approvalStatus==="pending"?"Waiting for approval":v.published?"Published":"Unpublished"}</span></td>
          <td>{v.processingStatus ? <div className="processing-cell"><span className={`processing-status ${v.processingStatus==="ready"?"ready":v.processingStatus==="error"||v.processingStatus==="upload failed"?"failed":"pending"}`}>{v.processingStatus}</span>{v.processingStatus!=="ready"&&v.processingStatus!=="error"&&v.processingStatus!=="upload failed"&&<span className="processing-progress">{Number(v.encodeProgress||0)}% encoded</span>}</div> : <span className="muted">—</span>}</td>
          <td><span className="table-views"><Eye size={14}/> {Number(v.views || 0).toLocaleString()}</span></td>
          <td><button className="icon-btn" title="Preview" disabled={Boolean(v.bunnyVideoId&&v.processingStatus!=="ready")} onClick={()=>{setSelected(v);setPage("home");}}><ExternalLink size={16}/></button><button className="icon-btn" title="Edit video" aria-label={`Edit ${v.title}`} onClick={()=>editVideo(v)}><Pencil size={16}/></button><button className="icon-btn" title={v.approvalStatus==="pending"?"Waiting for admin review":v.published?"Unpublish":"Publish"} aria-label={v.published?`Unpublish ${v.title}`:`Publish ${v.title}`} disabled={v.approvalStatus==="pending"||Boolean(v.bunnyVideoId&&v.processingStatus!=="ready")} onClick={()=>togglePublished(v)}>{v.published?<EyeOff size={16}/>:<Eye size={16}/>}</button><button className="icon-btn danger" title="Delete" onClick={()=>deleteVideo(v.id)}><Trash2 size={16}/></button></td>
        </tr>)}</tbody></table>{!videos.length&&<p className="muted empty-state">No videos yet. Add your first video.</p>}</div>
      </section>
      : (page === "admin" || page === "add" || page === "banner" || page === "categories" || page === "analytics" || page === "notifications" || page === "creator" || page === "creator-analytics" || page === "profile" || page === "my-creator-profile" || page === "business" || page === "invitations" || page === "promoter") ? <section className="admin-panel login-panel"><div className="login-card"><span className="eyebrow"><LayoutDashboard size={14}/> ZINDA PLAY ACCOUNT</span><h1>{registering ? registrationType === "business" ? "Create a business account" : registrationType === "promoter" ? "Become a promoter" : "Create your account" : "Welcome back"}</h1><p className="muted">{registering ? referrerPromoterId ? "Create your viewer account to link it to the promoter who invited you." : "Create an account to get started." : "Sign in to your account or use the admin credentials to open the dashboard."}</p><form className="login-form" onSubmit={login}>{registering && <label>Account type<select value={registrationType} disabled={loginLoading || Boolean(referrerPromoterId)} onChange={event=>setRegistrationType(event.target.value)}><option value="member">Viewer / creator account</option><option value="promoter">Promoter account</option><option value="business">Business / brand</option></select></label>}{registering && referrerPromoterId && <p className="publish-help">Referral rewards require a new viewer account. Creator features require separate admin approval.</p>}<label>Username<input autoComplete="username" minLength={3} maxLength={32} required value={username} onChange={e=>setUsername(e.target.value)} /></label><label>Password<input type="password" autoComplete={registering ? "new-password" : "current-password"} minLength={registering ? 8 : undefined} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)} /></label>{registering && registrationType==="business" && <><label>Business name<input required maxLength={100} value={businessProfile.businessName} onChange={event=>setBusinessProfile(current=>({...current,businessName:event.target.value}))}/></label><label>About your business<textarea maxLength={1000} rows={3} value={businessProfile.businessAbout} onChange={event=>setBusinessProfile(current=>({...current,businessAbout:event.target.value}))} placeholder="What does your business do?"/></label></>}{registering && <label className="profile-photo-field">{registrationType==="business"?"Business logo (optional)":"Profile photo (optional)"}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={loginLoading} onChange={e=>setProfilePhotoFile(e.target.files?.[0] || null)}/>{profilePhotoFile && profilePhotoPreview && <img className="profile-signup-preview" src={profilePhotoPreview} alt="Selected image preview"/>}<span>JPEG, PNG, WebP, or GIF, up to 8 MB.</span>{profilePhotoFile && <strong>{profilePhotoFile.name}</strong>}</label>}<button className="primary-btn" type="submit" disabled={loginLoading}>{loginLoading ? (registering ? "Creating account…" : "Signing in…") : (registering ? "Create account" : "Sign in")}</button></form><button className="auth-mode-toggle" type="button" onClick={()=>{setRegistering(!registering);setProfilePhotoFile(null);setError("");}}> {registering ? "Already have an account? Sign in" : "New to Zinda Play? Create an account"}</button>{registering && <p className="auth-help">Username: 3–32 letters, numbers, dots, underscores, or hyphens. Password: at least 8 characters.</p>}</div></section>
      : <><AdSlot api={API} placement="top"/>{banner && <section className="promo-banner">
        {banner.imageUrl && <img className="promo-banner-image" src={apiAssetSrc(banner.imageUrl)} alt="" aria-hidden="true"/>}
        <div className="promo-banner-copy"><span className="eyebrow"><Sparkles size={14}/> FEATURED</span><h2>{banner.title}</h2>{banner.description && <p>{banner.description}</p>}{banner.buttonLabel && <a className="primary-btn" href={banner.buttonUrl} target="_blank" rel="noreferrer">{banner.buttonLabel}<ExternalLink size={16}/></a>}</div>
      </section>}
        {sponsoredVideos.length > 0 && <section className="sponsored-library"><div className="section-heading"><div><span className="eyebrow"><Sparkles size={14}/> PROMOTED FOR YOUR LOCATION</span><h2>Promotional videos</h2></div></div><div className="vgrid">{sponsoredVideos.map((v,i)=>renderCard(v,i))}</div></section>}
        {trendingVideos.length > 0 && <section className="trending-library"><div className="section-heading"><div><span className="eyebrow"><TrendingUp size={14}/> TRENDING NOW · MOST VIEWED</span><h2>Popular videos</h2><p>Discover what viewers are watching most.</p></div><div className="scroller-controls"><button type="button" aria-label="Scroll trending videos left" onClick={()=>scrollTrending(-1)}><ChevronLeft size={18}/></button><button type="button" aria-label="Scroll trending videos right" onClick={()=>scrollTrending(1)}><ChevronRight size={18}/></button></div></div><div className="vrow" ref={trendingRow}>{trendingVideos.map((v,i)=>renderCard(v,i,i+1))}</div></section>}
        <div className="home-split"><section id="library" className="library"><div className="section-heading"><div><span className="eyebrow">HANDPICKED FOR YOU</span><h2>Explore the library</h2></div></div><div className="gallery-toolbar"><div className="gallery-toolbar-row"><div className="gallery-search"><Search size={17}/><input type="search" aria-label="Search videos by title" value={search} onChange={e=>{setSearch(e.target.value);setActiveCollectionKey("");}} placeholder="Search videos"/>{search && <button type="button" aria-label="Clear search" onClick={()=>setSearch("")}><X size={16}/></button>}</div><div className="sort-group" role="group" aria-label="Sort videos">{[["latest","Latest",Clock3],["trending","Trending",Flame],["viewed","Most viewed",Eye]].map(([key,label,Icon])=><button type="button" key={key} className={sortMode===key?"active":""} aria-pressed={sortMode===key} onClick={()=>{setSortMode(key);setActiveCollectionKey("");}}><Icon size={15}/>{label}</button>)}</div></div><div className="category-row"><button className={activeCategory==="all"?"category active":"category"} onClick={()=>{setActiveCategory("all");setActiveCollectionKey("");}}>All videos</button>{categories.map(c=><button key={c.id} className={activeCategory===c.id?"category active":"category"} onClick={()=>{setActiveCategory(c.id);setActiveCollectionKey("");}}>{c.name}</button>)}</div>{hasActiveFilters && <div className="active-filters">{search && <span className="filter-chip">Search: {search}<button type="button" aria-label="Remove search filter" onClick={()=>setSearch("")}><X size={13}/></button></span>}{activeCategory!=="all" && <span className="filter-chip">Category: {categories.find(c=>c.id===activeCategory)?.name || "Selected"}<button type="button" aria-label="Remove category filter" onClick={()=>setActiveCategory("all")}><X size={13}/></button></span>}{sortMode!=="latest" && <span className="filter-chip">Sort: {sortMode==="trending"?"Trending":"Most viewed"}<button type="button" aria-label="Reset sorting" onClick={()=>setSortMode("latest")}><X size={13}/></button></span>}<button type="button" className="clear-filters" onClick={clearFilters}>Clear filters</button>{!loading && !loadFailed && <span className="results-count">{filtered.length} {filtered.length===1?"video":"videos"}</span>}</div>}</div>{!activeCollectionKey && collectionGroups.length>0 && <section className="collections-library"><div className="collections-heading"><div><span className="eyebrow">WATCH TOGETHER</span><h3>Series & playlists</h3></div></div><div className="collections-grid">{collectionGroups.map(collection=><button className="collection-card" key={collection.key} onClick={()=>setActiveCollectionKey(collection.key)}><div className="collection-cover">{collection.videos[0]?.thumbnailUrl ? <img src={apiAssetSrc(collection.videos[0].thumbnailUrl)} alt=""/> : <div className="thumb-gradient gradient-0"><Play size={28} fill="currentColor"/></div>}<span>{collection.type==="series"?"WEB SERIES":"PLAYLIST"}</span></div><div><strong>{collection.title}</strong><small>{collection.videos.length} {collection.type==="series"?"episodes":"videos"}{collection.creatorName ? ` · ${collection.creatorName}` : ""}</small></div></button>)}</div></section>}{activeCollectionKey && <div className="active-collection-heading"><div><span className="eyebrow">{collectionGroups.find(collection=>collection.key===activeCollectionKey)?.type==="series"?"WEB SERIES":"PLAYLIST"}</span><h3>{collectionGroups.find(collection=>collection.key===activeCollectionKey)?.title || "Collection"}</h3><p>{filtered.length} videos, ordered by {collectionGroups.find(collection=>collection.key===activeCollectionKey)?.type==="series"?"episode":"playlist position"}.</p></div><button className="secondary-btn" onClick={()=>setActiveCollectionKey("")}>Back to all videos</button></div>}<AdSlot api={API} placement="middle"/>{loading?<div className="vgrid" aria-busy="true" aria-label="Loading videos">{Array.from({length:8},(_,i)=><VideoCardSkeleton key={i}/>)}</div>:loadFailed?<div className="gallery-state"><WifiOff size={34}/><h3>Couldn't load videos</h3><p>We couldn't reach the server. Check your connection and try again.</p><button className="primary-btn" onClick={load}><RefreshCw size={16}/> Retry</button></div>:filtered.length===0?<div className="gallery-state"><SearchX size={34}/><h3>No videos found</h3><p>{hasActiveFilters?"Nothing matches your current filters. Try a different search or category.":"No videos have been published yet."}</p>{hasActiveFilters && <button className="secondary-btn" onClick={clearFilters}>Clear filters</button>}</div>:<div className="vgrid">{filtered.map((v,i)=>renderCard(v,i))}</div>}</section>{popularCreators.length > 0 && <aside className="popular-creators" aria-label="Popular creators"><div className="popular-creators-heading"><span className="eyebrow"><Flame size={14}/> MOST FOLLOWED</span><h3>Popular creators</h3></div><ol>{popularCreators.map((creator,i)=><li key={creator.id}><button type="button" onClick={()=>openCreatorFromCard(creator)}><span className="popular-rank">{i+1}</span>{creator.profilePhotoUrl ? <img src={apiAssetSrc(creator.profilePhotoUrl)} alt=""/> : <span className="popular-avatar"><UserRound size={18}/></span>}<span className="popular-info"><strong>{creator.displayName}</strong><small>{Number(creator.followerCount).toLocaleString()} {creator.followerCount===1?"follower":"followers"}</small></span></button></li>)}</ol></aside>}</div><AdSlot api={API} placement="bottom"/></>}
    </main><footer><button className="brand footer-brand" onClick={()=>{setPage("home");setSelected(null);}}>Zinda<span className="brand-accent">Play</span></button><span>Made for stories, skills & discovery.</span><span>© {new Date().getFullYear()} Zinda Play</span></footer>
  </div>;
}
export default App;
