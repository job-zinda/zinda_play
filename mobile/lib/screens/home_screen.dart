import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../ads.dart';
import '../api.dart';
import '../theme.dart';
import '../widgets/video_card.dart';
import '../widgets/homepage_promotion_banner.dart';
import '../widgets/share_sheet.dart';
import '../widgets/muted_video_preview.dart';
import '../widgets/whatsapp_help_button.dart';
import 'auth_screen.dart';
import 'business_screen.dart';
import 'collection_screen.dart';
import 'creator_screen.dart';
import 'creator_search_screen.dart';
import 'inbox_screen.dart';
import 'promoter_screen.dart';
import 'studio_screen.dart';
import 'upload_screen.dart';
import 'watch_screen.dart';
import 'shorts_screen.dart';
import 'create_short_screen.dart';
import 'wallet_screen.dart';
import 'delete_account_screen.dart';
import 'account_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  List<Map<String, dynamic>> _videos = [];
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _popular = [];
  List<Map<String, dynamic>> _banners = [];
  List<Map<String, dynamic>> _creatorMatches = [];
  String _category = '';
  String _sort = 'Trending';
  bool _searchVisible = false;
  bool _loading = true;
  String? _error;
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _searchFocus.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _list(dynamic data) =>
      (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  num _views(Map<String, dynamic> v) => (v['views'] as num?) ?? 0;

  List<Map<String, dynamic>> get _orderedVideos {
    final videos = [..._videos];
    if (_sort == 'Trending') {
      videos.sort((a, b) => _views(b).compareTo(_views(a)));
    }
    return videos;
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = Uri(
        queryParameters: {
          if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
          if (_category.isNotEmpty) 'category': _category,
        },
      ).query;
      final term = _search.text.trim();
      final results = await Future.wait([
        Api.instance.get('/videos${query.isEmpty ? '' : '?$query'}'),
        Api.instance.get('/categories'),
        Api.instance.get('/discover/popular-creators'),
        Api.instance.get('/banners').catchError((_) => <dynamic>[]),
        term.length < 2
            ? Future<dynamic>.value(<dynamic>[])
            : Api.instance
                  .get(
                    '/discover/creators?search=${Uri.encodeQueryComponent(term)}',
                  )
                  .catchError((_) => <dynamic>[]),
      ]);
      if (!mounted) return;
      setState(() {
        _videos = _list(results[0]);
        _categories = _list(results[1]);
        _popular = _list(results[2]);
        _banners = results[3] is List ? _list(results[3]) : [];
        _creatorMatches = results[4] is List ? _list(results[4]) : [];
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = '$e';
        _loading = false;
      });
    }
  }

  Map<String, dynamic>? _creatorOf(Map<String, dynamic> v) =>
      v['creatorProfile'] == null
      ? null
      : Map<String, dynamic>.from(v['creatorProfile'] as Map);

  void _openVideo(Map<String, dynamic> video) => Navigator.push(
    context,
    MaterialPageRoute(builder: (_) => WatchScreen(video: video)),
  );

  void _openCreator(Map<String, dynamic> creator) => Navigator.push(
    context,
    MaterialPageRoute(builder: (_) => CreatorScreen(creator: creator)),
  );

  Future<void> _push(Widget page) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => page));
    if (mounted) setState(() {});
  }

  void _toast(String text) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _upload() async {
    if (!Api.instance.signedIn) return _push(const AuthScreen());
    switch (Api.instance.role) {
      case 'creator':
        return _push(const UploadScreen());
      case 'business':
        return _push(const BusinessScreen());
      default:
        _toast('Uploading is available for creator and business accounts.');
    }
  }

  Future<void> _create() async {
    final short = await showModalBottomSheet<bool>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.video_library_outlined),
              title: const Text('Upload regular video'),
              onTap: () => Navigator.pop(context, false),
            ),
            ListTile(
              leading: const Icon(Icons.video_collection_outlined),
              title: const Text('Create Simply'),
              subtitle: const Text('9:16 portrait, up to 60 seconds'),
              onTap: () => Navigator.pop(context, true),
            ),
          ],
        ),
      ),
    );
    if (!mounted || short == null) return;
    if (!short) return _upload();
    if (!Api.instance.signedIn) await _push(const AuthScreen());
    if (!mounted || !Api.instance.signedIn) return;
    try {
      await Api.instance.refreshAccountRole();
      if (!mounted) return;
      if (Api.instance.role != 'creator') {
        _toast(
          'Simply uploads require approved creator access. Use Creator studio or Switch to creator / apply in your profile.',
        );
        return;
      }
      await _push(const CreateShortScreen());
    } catch (error) {
      if (mounted) _toast('$error');
    }
  }

  Future<void> _earn() async {
    if (!Api.instance.signedIn) await _push(const AuthScreen());
    if (!mounted || !Api.instance.signedIn) return;
    try {
      await Api.instance.refreshAccountRole();
      if (!mounted) return;
      if (Api.instance.role == 'creator') {
        return await _push(const WalletScreen());
      }
      if (Api.instance.role == 'promoter') {
        return await _push(const PromoterScreen());
      }
      _toast('Earnings are available to approved creators and promoters.');
    } catch (error) {
      if (mounted) _toast('$error');
    }
  }

  Future<void> _profile() async {
    if (!Api.instance.signedIn) {
      await _push(const AuthScreen());
      if (!mounted || !Api.instance.signedIn) return;
    }
    try {
      await Api.instance.refreshAccountRole();
    } catch (error) {
      if (mounted) _toast('$error');
    }
    if (!mounted) return;
    final role = Api.instance.role;
    await showModalBottomSheet(
      context: context,
      backgroundColor: kPanel,
      builder: (ctx) => SafeArea(
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.privacy_tip_outlined),
                title: const Text('Privacy Policy'),
                onTap: () {
                  Navigator.pop(ctx);
                  _privacy();
                },
              ),
              ListTile(
                leading: const Icon(
                  Icons.delete_forever,
                  color: Colors.redAccent,
                ),
                title: const Text('Delete account'),
                onTap: () {
                  Navigator.pop(ctx);
                  _deleteAccount();
                },
              ),
              ListTile(
                leading: _avatar(radius: 22),
                title: Text(
                  Api.instance.username ?? 'Account',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                subtitle: Text(
                  (role ?? 'member').toUpperCase(),
                  style: const TextStyle(fontSize: 11, color: kMuted),
                ),
              ),
              const Divider(height: 1, color: kLine),
              ListTile(
                leading: const Icon(Icons.manage_accounts_outlined),
                title: const Text('Profile & account settings'),
                subtitle: const Text('Username, recovery email & creator application'),
                onTap: () {
                  Navigator.pop(ctx);
                  _push(const AccountScreen());
                },
              ),
              if (role == 'creator') ...[
                ListTile(
                  leading: const Icon(Icons.video_library_outlined),
                  title: const Text('Creator studio'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _push(const StudioScreen());
                  },
                ),
                ListTile(
                  leading: const Icon(Icons.notifications_none),
                  title: const Text('Notifications & messages'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _push(const InboxScreen());
                  },
                ),
              ],
              if (role == 'business')
                ListTile(
                  leading: const Icon(Icons.business_center_outlined),
                  title: const Text('Business dashboard'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _push(const BusinessScreen());
                  },
                ),
              if (role == 'promoter')
                ListTile(
                  leading: const Icon(Icons.campaign_outlined),
                  title: const Text('Promoter dashboard'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _push(const PromoterScreen());
                  },
                ),
              if (Api.instance.promoterAccount)
                ListTile(
                  leading: const Icon(Icons.swap_horiz),
                  title: Text(
                    role == 'promoter'
                        ? 'Switch to creator / apply'
                        : 'Switch to promoter',
                  ),
                  onTap: () {
                    Navigator.pop(ctx);
                    _switchMode(role == 'promoter' ? 'creator' : 'promoter');
                  },
                ),
              ListTile(
                leading: const Icon(Icons.logout),
                title: const Text('Sign out'),
                onTap: () async {
                  Navigator.pop(ctx);
                  await Api.instance.logout();
                  if (mounted) setState(() {});
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _deleteAccount() async {
    final deleted = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const DeleteAccountScreen()),
    );
    if (!mounted) return;
    setState(() {});
    if (deleted == true) {
      _toast('Your account has been deleted.');
      await _load();
    }
  }

  Future<void> _privacy() async {
    try {
      if (!await launchUrl(
        Uri.parse('https://zindaplayprivacypolicy.vercel.app/'),
        mode: LaunchMode.externalApplication,
      )) {
        throw Exception('Could not open the privacy policy.');
      }
    } catch (error) {
      if (mounted) _toast('$error');
    }
  }

  Future<void> _switchMode(String mode) async {
    try {
      final result = await Api.instance.switchMode(mode);
      if (!mounted) return;
      setState(() {});
      if (result['role'] == 'creator') {
        await _push(const StudioScreen());
      } else if (result['role'] == 'promoter') {
        await _push(const PromoterScreen());
      } else {
        await _push(const AccountScreen());
      }
    } catch (error) {
      if (mounted) _toast('$error');
    }
  }

  Widget _avatar({double radius = 18}) {
    final name = Api.instance.username ?? '';
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: const BoxDecoration(
        shape: BoxShape.circle,
        gradient: kGradient,
      ),
      child: CircleAvatar(
        radius: radius,
        backgroundColor: kPanel,
        child: Api.instance.signedIn && name.isNotEmpty
            ? Text(
                name[0].toUpperCase(),
                style: const TextStyle(fontWeight: FontWeight.w800),
              )
            : const Icon(Icons.person_outline, size: 20),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            if (_tab != 1) _header(),
            Expanded(
              child: _tab == 1
                  ? const ShortsScreen()
                  : _tab == 0
                  ? _home()
                  : _explore(),
            ),
          ],
        ),
      ),
      bottomNavigationBar: _bottomBar(),
      floatingActionButton: _tab == 0 ? const WhatsAppHelpButton() : null,
    );
  }

  Widget _header() {
    final signedIn = Api.instance.signedIn;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 6, 10, 4),
      child: Row(
        children: [
          Image.asset(
            'assets/icon.png',
            width: 36,
            height: 36,
            fit: BoxFit.contain,
            semanticLabel: 'Zinda Play',
          ),
          const SizedBox(width: 8),
          const Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  TextSpan(
                    text: 'Zinda ',
                    style: TextStyle(color: Colors.white),
                  ),
                  TextSpan(
                    text: 'Play',
                    style: TextStyle(color: Color(0xFFC026D3)),
                  ),
                ],
              ),
              style: TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.5,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          IconButton(
            tooltip: 'Search',
            icon: const Icon(Icons.search),
            onPressed: () {
              setState(() {
                _tab = 0;
                _searchVisible = !_searchVisible;
              });
              if (_searchVisible) _searchFocus.requestFocus();
            },
          ),
          IconButton(
            tooltip: 'Notifications',
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.notifications_none),
                if (signedIn)
                  const Positioned(
                    right: -1,
                    top: -1,
                    child: CircleAvatar(
                      radius: 4,
                      backgroundColor: Color(0xFFFF1688),
                    ),
                  ),
              ],
            ),
            onPressed: () => signedIn
                ? _push(const InboxScreen())
                : _push(const AuthScreen()),
          ),
          InkWell(
            customBorder: const CircleBorder(),
            onTap: _profile,
            child: _avatar(radius: 17),
          ),
        ],
      ),
    );
  }

  Widget _home() {
    final filtering = _search.text.trim().isNotEmpty || _category.isNotEmpty;
    final videos = _orderedVideos;
    final feed = <Widget>[];
    for (var i = 0; i < videos.length; i++) {
      final video = videos[i];
      feed.add(_videoFeedRow(video));
      if (i == 2) {
        feed.add(const AdBanner(placement: 'top'));
        if (_banners.isNotEmpty) {
          feed.add(HomepagePromotionCarousel(banners: _banners));
        }
      }
      if (i == 5) feed.add(const AdBanner(placement: 'middle'));
    }
    if (videos.length < 3) {
      feed.add(const AdBanner(placement: 'top'));
      if (_banners.isNotEmpty) {
        feed.add(HomepagePromotionCarousel(banners: _banners));
      }
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.only(bottom: 96),
        children: [
          if (_searchVisible) _searchField(),
          if (!filtering) _creatorSearchEntry(),
          if (!_loading && _error == null && filtering) ..._matchingCreators(),
          if (!_loading && _error == null && !filtering) ..._creators(),
          if (!_loading && _error == null && !filtering) ..._trending(),
          _categoryFilters(),
          if (_loading)
            _skeletons()
          else if (_error != null)
            _errorState()
          else if (_videos.isEmpty)
            _emptyState(filtering)
          else ...[
            if (filtering)
              _heading('Results', Icons.grid_view_rounded, topPadding: 8),
            ...feed,
            if (!filtering) ..._collections(),
            const AdBanner(placement: 'bottom'),
          ],
        ],
      ),
    );
  }

  Widget _searchField() => Padding(
    padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
    child: TextField(
      controller: _search,
      focusNode: _searchFocus,
      textInputAction: TextInputAction.search,
      onSubmitted: (_) => _load(),
      decoration: InputDecoration(
        hintText: 'Search videos, creators or topics...',
        hintStyle: const TextStyle(color: kMuted, fontSize: 14),
        prefixIcon: const Icon(Icons.search, color: kMuted),
        suffixIcon: _search.text.isEmpty
            ? null
            : IconButton(
                icon: const Icon(Icons.close, size: 18),
                onPressed: () {
                  _search.clear();
                  _load();
                },
              ),
        filled: true,
        fillColor: kBg,
        contentPadding: const EdgeInsets.symmetric(vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(28),
          borderSide: const BorderSide(color: Color(0xFF3A3B4C)),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(28),
          borderSide: const BorderSide(color: kPurple),
        ),
      ),
      onChanged: (_) => setState(() {}),
    ),
  );

  Widget _categoryFilters() => SizedBox(
    height: 48,
    child: Row(
      children: [
        Expanded(
          child: ListView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.only(left: 10, right: 4),
            children: [
              _chip('All', ''),
              for (final c in _categories) _chip('${c['name']}', '${c['id']}'),
            ],
          ),
        ),
        PopupMenuButton<String>(
          tooltip: 'Sort videos',
          initialValue: _sort,
          onSelected: (value) => setState(() => _sort = value),
          itemBuilder: (_) => const [
            PopupMenuItem(value: 'Trending', child: Text('Trending')),
            PopupMenuItem(value: 'Latest', child: Text('Latest')),
          ],
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _sort,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(width: 3),
                const Icon(Icons.keyboard_arrow_down, size: 20),
              ],
            ),
          ),
        ),
      ],
    ),
  );

  Widget _chip(String label, String id) {
    final active = _category == id;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Material(
        color: Colors.transparent,
        child: Ink(
          decoration: BoxDecoration(
            gradient: active ? kGradient : null,
            borderRadius: BorderRadius.circular(22),
            border: active ? null : Border.all(color: const Color(0xFF3A3B4C)),
          ),
          child: InkWell(
            borderRadius: BorderRadius.circular(22),
            onTap: () {
              setState(() => _category = id);
              _load();
            },
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  if (active)
                    const Padding(
                      padding: EdgeInsets.only(right: 6),
                      child: Icon(Icons.check, size: 16),
                    ),
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _heading(
    String text,
    IconData icon, {
    Color color = kPurple,
    double topPadding = 18,
  }) => Padding(
    padding: EdgeInsets.fromLTRB(16, topPadding, 16, 8),
    child: Row(
      children: [
        Icon(icon, size: 20, color: color),
        const SizedBox(width: 8),
        Text(
          text,
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
        ),
      ],
    ),
  );

  List<Widget> _collections({String title = 'Web series & playlists'}) {
    final groups = VideoCollection.group(_videos);
    if (groups.isEmpty) return const [];
    return [
      _heading(
        title,
        Icons.playlist_play_rounded,
        color: const Color(0xFF38BDF8),
      ),
      SizedBox(
        height: 175,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          physics: const BouncingScrollPhysics(),
          itemCount: groups.length,
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (_, i) => SizedBox(
            width: 210,
            child: CollectionCard(
              collection: groups[i],
              onTap: () => _push(CollectionScreen(collection: groups[i])),
            ),
          ),
        ),
      ),
    ];
  }

  List<Widget> _trending() {
    final videos = _videos
        .where((video) => video['isSponsored'] != true && _views(video) > 0)
        .toList()
      ..sort((a, b) => _views(b).compareTo(_views(a)));
    final items = videos.take(10).toList();
    if (items.isEmpty) return const [];
    return [
      _heading(
        'Trending now',
        Icons.local_fire_department,
        color: const Color(0xFFFF7A3D),
        topPadding: 8,
      ),
      SizedBox(
        height: 240,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (_, index) {
            final video = items[index];
            final creator = _creatorOf(video);
            return SizedBox(
              width: 210,
              child: VideoCard(
                video: video,
                onTap: () => _openVideo(video),
                onCreator: creator == null ? null : () => _openCreator(creator),
              ),
            );
          },
        ),
      ),
    ];
  }

  Widget _creatorSearchEntry() => Padding(
    padding: const EdgeInsets.fromLTRB(14, 6, 14, 2),
    child: Material(
      color: kPanel,
      borderRadius: BorderRadius.circular(28),
      child: InkWell(
        key: const ValueKey('creator-search-entry'),
        borderRadius: BorderRadius.circular(28),
        onTap: () => _push(const CreatorSearchScreen()),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: const Color(0xFF3A3B4C)),
          ),
          child: const Row(
            children: [
              Icon(Icons.person_search_outlined, color: kMuted, size: 20),
              SizedBox(width: 10),
              Text(
                'Search content creators',
                style: TextStyle(color: kMuted, fontSize: 14),
              ),
            ],
          ),
        ),
      ),
    ),
  );

  List<Widget> _matchingCreators() {
    if (_creatorMatches.isEmpty) return const [];
    return [
      _heading('Creators', Icons.person_search_outlined, topPadding: 8),
      for (final c in _creatorMatches.take(5))
        ListTile(
          dense: true,
          leading: CircleAvatar(
            backgroundColor: kPanel,
            backgroundImage: assetUrl('${c['profilePhotoUrl'] ?? ''}').isEmpty
                ? null
                : NetworkImage(assetUrl('${c['profilePhotoUrl'] ?? ''}')),
            child: assetUrl('${c['profilePhotoUrl'] ?? ''}').isEmpty
                ? const Icon(Icons.person)
                : null,
          ),
          title: Text('${c['displayName'] ?? c['username']}'),
          subtitle: Text('@${c['username']}'),
          trailing: const Icon(Icons.chevron_right),
          onTap: () => _openCreator(c),
        ),
    ];
  }

  List<Widget> _creators() {
    if (_popular.isEmpty) return const [];
    return [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 14, 4),
        child: Row(
          children: [
            const Icon(Icons.star_rounded, size: 22, color: Color(0xFFD946EF)),
            const SizedBox(width: 6),
            const Expanded(
              child: Text(
                'Popular Creators',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
              ),
            ),
            TextButton(
              onPressed: () => setState(() => _tab = 2),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('See all'),
                  Icon(Icons.chevron_right, size: 20),
                ],
              ),
            ),
          ],
        ),
      ),
      SizedBox(
        height: 104,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
          physics: const BouncingScrollPhysics(),
          itemCount: _popular.length,
          separatorBuilder: (_, _) => const SizedBox(width: 8),
          itemBuilder: (_, i) {
            final c = _popular[i];
            final photo = assetUrl('${c['profilePhotoUrl'] ?? ''}');
            return InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => _openCreator(c),
              child: SizedBox(
                width: 68,
                child: Column(
                  children: [
                    Container(
                      padding: const EdgeInsets.all(2),
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: kGradient,
                      ),
                      child: CircleAvatar(
                        radius: 30,
                        backgroundColor: kPanel,
                        backgroundImage: photo.isEmpty
                            ? null
                            : NetworkImage(photo),
                        child: photo.isEmpty ? const Icon(Icons.person) : null,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      '${c['displayName'] ?? c['username']}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    ];
  }

  Widget _videoFeedRow(Map<String, dynamic> video) {
    final creator = _creatorOf(video);
    final thumbnail = assetUrl(video['thumbnailUrl'] as String?);
    final profilePhoto = assetUrl(creator?['profilePhotoUrl'] as String?);
    final duration = formatDuration(video['durationSeconds'] as num?);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 12, 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: InkWell(
                  onTap: () => _openVideo(video),
                  borderRadius: BorderRadius.circular(12),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: AspectRatio(
                      aspectRatio: 16 / 9,
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          thumbnail.isEmpty
                              ? MutedVideoPreview(video: video)
                              : Image.network(
                                  thumbnail,
                                  fit: BoxFit.cover,
                                  errorBuilder: (_, _, _) =>
                                      Container(color: kPanel),
                                ),
                          if (video['isSponsored'] == true)
                            Positioned(
                              top: 5,
                              left: 5,
                              child: _feedBadge('SPONSORED'),
                            ),
                          if (duration.isNotEmpty)
                            Positioned(
                              right: 5,
                              bottom: 5,
                              child: _feedBadge(duration),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        InkWell(
                          onTap: creator == null
                              ? null
                              : () => _openCreator(creator),
                          customBorder: const CircleBorder(),
                          child: CircleAvatar(
                            radius: 15,
                            backgroundColor: kPanel,
                            backgroundImage: profilePhoto.isEmpty
                                ? null
                                : NetworkImage(profilePhoto),
                            child: profilePhoto.isEmpty
                                ? const Icon(Icons.person_outline, size: 17)
                                : null,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              InkWell(
                                onTap: creator == null
                                    ? null
                                    : () => _openCreator(creator),
                                child: Text(
                                  '${creator?['displayName'] ?? creator?['username'] ?? 'Zinda Play'}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              Text(
                                _relativeTime(video['createdAt']),
                                style: const TextStyle(
                                  fontSize: 11,
                                  color: kMuted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        PopupMenuButton<String>(
                          padding: EdgeInsets.zero,
                          iconSize: 20,
                          tooltip: 'Video options',
                          onSelected: (value) {
                            if (value == 'share') {
                              showVideoShareSheet(context, video);
                            } else if (value == 'creator' && creator != null) {
                              _openCreator(creator);
                            }
                          },
                          itemBuilder: (_) => [
                            const PopupMenuItem(
                              value: 'share',
                              child: Text('Share'),
                            ),
                            if (creator != null)
                              const PopupMenuItem(
                                value: 'creator',
                                child: Text('View creator'),
                              ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    InkWell(
                      onTap: () => _openVideo(video),
                      child: Text(
                        '${video['title'] ?? ''}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 14, height: 1.25),
                      ),
                    ),
                    const SizedBox(height: 7),
                    Row(
                      children: [
                        _feedMetric(
                          Icons.remove_red_eye_outlined,
                          _compactCount(_views(video)),
                        ),
                        if (video['likeCount'] is num) ...[
                          const SizedBox(width: 9),
                          _feedMetric(
                            Icons.favorite_border,
                            _compactCount(video['likeCount'] as num),
                          ),
                        ],
                        if (video['commentCount'] is num) ...[
                          const SizedBox(width: 9),
                          _feedMetric(
                            Icons.chat_bubble_outline,
                            _compactCount(video['commentCount'] as num),
                          ),
                        ],
                        const Spacer(),
                        InkWell(
                          onTap: () => showVideoShareSheet(context, video),
                          child: const Padding(
                            padding: EdgeInsets.all(2),
                            child: Icon(
                              Icons.send_outlined,
                              size: 17,
                              color: Colors.white70,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const Divider(height: 1, color: Color(0xFF1A1B25)),
      ],
    );
  }

  Widget _feedBadge(String text) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
    decoration: BoxDecoration(
      color: Colors.black87,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      text,
      style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700),
    ),
  );

  Widget _feedMetric(IconData icon, String value) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      Icon(icon, size: 17, color: Colors.white70),
      const SizedBox(width: 3),
      Text(value, style: const TextStyle(fontSize: 11, color: Colors.white70)),
    ],
  );

  String _compactCount(num count) {
    if (count >= 1000000) return '${(count / 1000000).toStringAsFixed(1)}M';
    if (count >= 1000) return '${(count / 1000).toStringAsFixed(1)}K';
    return count.toInt().toString();
  }

  String _relativeTime(dynamic value) {
    final createdAt = DateTime.tryParse('$value');
    if (createdAt == null) return '';
    final age = DateTime.now().difference(createdAt);
    if (age.inMinutes < 1) return 'Just now';
    if (age.inHours < 1) return '${age.inMinutes}m ago';
    if (age.inDays < 1) return '${age.inHours}h ago';
    if (age.inDays < 7) return '${age.inDays}d ago';
    return '${createdAt.day}/${createdAt.month}/${createdAt.year}';
  }

  Widget _skeletons() => Padding(
    padding: const EdgeInsets.fromLTRB(14, 10, 14, 0),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Skeleton(width: 150, height: 18),
        const SizedBox(height: 10),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: 7,
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (_, _) => const SizedBox(
              width: 64,
              child: Column(
                children: [
                  Skeleton(height: 60, radius: 32),
                  SizedBox(height: 6),
                  Skeleton(width: 48, height: 10),
                ],
              ),
            ),
          ),
        ),
        for (var i = 0; i < 3; i++)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Expanded(
                  child: AspectRatio(
                    aspectRatio: 16 / 9,
                    child: Skeleton(height: 100, radius: 12),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Skeleton(width: 100, height: 14),
                      const SizedBox(height: 8),
                      const Skeleton(height: 14, width: double.infinity),
                      const SizedBox(height: 5),
                      Skeleton(height: 14, width: i == 1 ? 80 : 120),
                      const SizedBox(height: 10),
                      const Skeleton(width: 90, height: 12),
                    ],
                  ),
                ),
              ],
            ),
          ),
      ],
    ),
  );

  Widget _errorState() => Padding(
    padding: const EdgeInsets.all(32),
    child: Column(
      children: [
        const Icon(Icons.wifi_off_rounded, size: 40, color: kMuted),
        const SizedBox(height: 10),
        Text(
          _error!,
          textAlign: TextAlign.center,
          style: const TextStyle(color: kMuted),
        ),
        const SizedBox(height: 14),
        GradientButton(
          onPressed: _load,
          child: const Text(
            'Retry',
            style: TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );

  Widget _emptyState(bool filtering) => Padding(
    padding: const EdgeInsets.all(48),
    child: Column(
      children: [
        const Icon(Icons.video_library_outlined, size: 40, color: kMuted),
        const SizedBox(height: 10),
        Text(
          filtering
              ? 'No videos match your search.'
              : 'No videos yet. Check back soon.',
          textAlign: TextAlign.center,
          style: const TextStyle(color: kMuted),
        ),
      ],
    ),
  );

  Widget _explore() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          const Text(
            'Popular creators',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          if (_loading)
            const Padding(
              padding: EdgeInsets.all(32),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_popular.isEmpty)
            const Padding(
              padding: EdgeInsets.all(24),
              child: Text('No creators yet.', style: TextStyle(color: kMuted)),
            ),
          for (var i = 0; i < _popular.length; i++)
            ListTile(
              leading: CircleAvatar(
                backgroundImage:
                    '${_popular[i]['profilePhotoUrl'] ?? ''}'.isEmpty
                    ? null
                    : NetworkImage(
                        assetUrl('${_popular[i]['profilePhotoUrl']}'),
                      ),
                child: '${_popular[i]['profilePhotoUrl'] ?? ''}'.isEmpty
                    ? const Icon(Icons.person)
                    : null,
              ),
              title: Text(
                '${i + 1}. ${_popular[i]['displayName'] ?? _popular[i]['username']}',
              ),
              subtitle: Text(
                '${_popular[i]['followerCount']} followers',
                style: const TextStyle(color: kMuted),
              ),
              onTap: () => _openCreator(_popular[i]),
            ),
        ],
      ),
    );
  }

  Widget _bottomBar() {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFF0B0C14),
        border: Border(top: BorderSide(color: Color(0x14FFFFFF))),
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 66,
          child: Row(
            children: [
              _navItem(
                Icons.home_rounded,
                Icons.home_outlined,
                'Home',
                _tab == 0,
                () => setState(() => _tab = 0),
              ),
              _navItem(
                Icons.video_collection,
                Icons.video_collection_outlined,
                'Simply',
                _tab == 1,
                () => setState(() => _tab = 1),
              ),
              Expanded(
                child: Center(
                  child: GradientButton(
                    onPressed: _create,
                    radius: 16,
                    padding: const EdgeInsets.all(12),
                    child: const Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.add, size: 24),
                        Text('Create', style: TextStyle(fontSize: 10)),
                      ],
                    ),
                  ),
                ),
              ),
              _navItem(
                Icons.account_balance_wallet,
                Icons.account_balance_wallet_outlined,
                'Earn',
                false,
                _earn,
              ),
              _navItem(
                Icons.person,
                Icons.person_outline,
                'Profile',
                false,
                _profile,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _navItem(
    IconData active,
    IconData idle,
    String label,
    bool selected,
    VoidCallback onTap,
  ) {
    final color = selected ? const Color(0xFFD6C8FF) : const Color(0xFFA7A6B7);
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Center(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 200),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(
              color: selected ? const Color(0x338B5CF6) : Colors.transparent,
              borderRadius: BorderRadius.circular(18),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(selected ? active : idle, color: color, size: 24),
                const SizedBox(height: 2),
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    color: color,
                    fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
