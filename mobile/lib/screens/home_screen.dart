import 'package:flutter/material.dart';

import '../ads.dart';
import '../api.dart';
import '../theme.dart';
import '../widgets/video_card.dart';
import '../widgets/homepage_promotion_banner.dart';
import 'auth_screen.dart';
import 'business_screen.dart';
import 'collection_screen.dart';
import 'creator_screen.dart';
import 'inbox_screen.dart';
import 'promoter_screen.dart';
import 'studio_screen.dart';
import 'upload_screen.dart';
import 'watch_screen.dart';
import 'shorts_screen.dart';
import 'create_short_screen.dart';
import 'wallet_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _search = TextEditingController();
  final _searchFocus = FocusNode();
  final _pager = PageController();
  List<Map<String, dynamic>> _videos = [];
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _popular = [];
  Map<String, dynamic>? _promotion;
  String _category = '';
  bool _loading = true;
  String? _error;
  int _tab = 0;
  int _featuredIndex = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _search.dispose();
    _searchFocus.dispose();
    _pager.dispose();
    super.dispose();
  }

  List<Map<String, dynamic>> _list(dynamic data) =>
      (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  num _views(Map<String, dynamic> v) => (v['views'] as num?) ?? 0;

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final query = Uri(queryParameters: {
        if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
        if (_category.isNotEmpty) 'category': _category,
      }).query;
      final results = await Future.wait([
        Api.instance.get('/videos${query.isEmpty ? '' : '?$query'}'),
        Api.instance.get('/categories'),
        Api.instance.get('/discover/popular-creators'),
        Api.instance.get('/banner'),
      ]);
      if (!mounted) return;
      setState(() {
        _videos = _list(results[0]);
        _categories = _list(results[1]);
        _popular = _list(results[2]);
        _promotion = results[3] == null ? null : Map<String, dynamic>.from(results[3] as Map);
        _featuredIndex = 0;
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
      v['creatorProfile'] == null ? null : Map<String, dynamic>.from(v['creatorProfile'] as Map);

  void _openVideo(Map<String, dynamic> video) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => WatchScreen(video: video)));

  void _openCreator(Map<String, dynamic> creator) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => CreatorScreen(creator: creator)));

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
    final short = await showModalBottomSheet<bool>(context: context, builder: (context) => SafeArea(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        ListTile(leading: const Icon(Icons.video_library_outlined), title: const Text('Upload regular video'), onTap: () => Navigator.pop(context, false)),
        ListTile(leading: const Icon(Icons.video_collection_outlined), title: const Text('Create Simply'), subtitle: const Text('9:16 portrait, up to 60 seconds'), onTap: () => Navigator.pop(context, true)),
      ]),
    ));
    if (!mounted || short == null) return;
    if (!short) return _upload();
    if (!Api.instance.signedIn) await _push(const AuthScreen());
    if (!mounted || !Api.instance.signedIn) return;
    try {
      await Api.instance.refreshAccountRole();
      if (!mounted) return;
      if (Api.instance.role != 'creator') {
        _toast('Simply uploads require approved creator access. Use Creator studio or Switch to creator / apply in your profile.');
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
      if (Api.instance.role == 'creator') return await _push(const WalletScreen());
      if (Api.instance.role == 'promoter') return await _push(const PromoterScreen());
      _toast('Earnings are available to approved creators and promoters.');
    } catch (error) {
      if (mounted) _toast('$error');
    }
  }

  Future<void> _library() async {
    if (!Api.instance.signedIn) return _push(const AuthScreen());
    try {
      await Api.instance.refreshAccountRole();
    } catch (error) {
      if (mounted) _toast('$error');
      return;
    }
    if (!mounted) return;
    switch (Api.instance.role) {
      case 'creator':
        return _push(const StudioScreen());
      case 'business':
        return _push(const BusinessScreen());
      case 'promoter':
        return _push(const PromoterScreen());
      default:
        _toast('Your library is available for creator, business and promoter accounts.');
    }
  }

  Future<void> _profile() async {
    if (!Api.instance.signedIn) return _push(const AuthScreen());
    try {
      await Api.instance.refreshAccountRole();
    } catch (error) {
      if (mounted) _toast('$error');
      return;
    }
    if (!mounted) return;
    final role = Api.instance.role;
    await showModalBottomSheet(
      context: context,
      backgroundColor: kPanel,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(
            leading: _avatar(radius: 22),
            title: Text(Api.instance.username ?? 'Account', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text((role ?? 'member').toUpperCase(), style: const TextStyle(fontSize: 11, color: kMuted)),
          ),
          const Divider(height: 1, color: kLine),
          if (role == 'creator') ...[
            ListTile(leading: const Icon(Icons.video_library_outlined), title: const Text('Creator studio'), onTap: () { Navigator.pop(ctx); _push(const StudioScreen()); }),
            ListTile(leading: const Icon(Icons.notifications_none), title: const Text('Notifications & messages'), onTap: () { Navigator.pop(ctx); _push(const InboxScreen()); }),
          ],
          if (role == 'business')
            ListTile(leading: const Icon(Icons.business_center_outlined), title: const Text('Business dashboard'), onTap: () { Navigator.pop(ctx); _push(const BusinessScreen()); }),
          if (role == 'promoter')
            ListTile(leading: const Icon(Icons.campaign_outlined), title: const Text('Promoter dashboard'), onTap: () { Navigator.pop(ctx); _push(const PromoterScreen()); }),
          if (Api.instance.promoterAccount)
            ListTile(
              leading: const Icon(Icons.swap_horiz),
              title: Text(role == 'promoter' ? 'Switch to creator / apply' : 'Switch to promoter'),
              onTap: () { Navigator.pop(ctx); _switchMode(role == 'promoter' ? 'creator' : 'promoter'); },
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
        ]),
      ),
    );
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
        _toast(result['approvalStatus'] == 'rejected'
            ? 'Creator access was declined. Your promoter account is still available.'
            : 'Creator application pending admin approval. Your promoter account and rewards are retained.');
      }
    } catch (error) {
      if (mounted) _toast('$error');
    }
  }

  Widget _avatar({double radius = 18}) {
    final name = Api.instance.username ?? '';
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: const BoxDecoration(shape: BoxShape.circle, gradient: kGradient),
      child: CircleAvatar(
        radius: radius,
        backgroundColor: kPanel,
        child: Api.instance.signedIn && name.isNotEmpty
            ? Text(name[0].toUpperCase(), style: const TextStyle(fontWeight: FontWeight.w800))
            : const Icon(Icons.person_outline, size: 20),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Column(children: [
          if (_tab != 1) _header(),
          Expanded(child: _tab == 1 ? const ShortsScreen() : _tab == 0 ? _home() : _explore()),
        ]),
      ),
      bottomNavigationBar: _bottomBar(),
    );
  }

  Widget _header() {
    final signedIn = Api.instance.signedIn;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 6, 10, 2),
      child: Row(children: [
        Image.asset('assets/banner.png', height: 34, semanticLabel: 'ZindaPlay'),
        const Spacer(),
        IconButton(tooltip: 'Explore', icon: const Icon(Icons.explore_outlined), onPressed: () => setState(() => _tab = 2)),
        IconButton(tooltip: 'Library / dashboard', icon: const Icon(Icons.video_library_outlined), onPressed: _library),
        IconButton(
          tooltip: 'Search',
          icon: const Icon(Icons.search),
          onPressed: () {
            setState(() => _tab = 0);
            _searchFocus.requestFocus();
          },
        ),
        if (signedIn && Api.instance.role == 'creator')
          IconButton(
            tooltip: 'Notifications',
            icon: const Icon(Icons.notifications_none),
            onPressed: () => _push(const InboxScreen()),
          ),
        InkWell(customBorder: const CircleBorder(), onTap: _profile, child: _avatar()),
      ]),
    );
  }

  Widget _home() {
    final filtering = _search.text.trim().isNotEmpty || _category.isNotEmpty;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.only(bottom: 24), children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 10),
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
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(28), borderSide: const BorderSide(color: Color(0xFF3A3B4C))),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(28), borderSide: const BorderSide(color: kPurple)),
            ),
            onChanged: (_) => setState(() {}),
          ),
        ),
        SizedBox(
          height: 42,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 10), children: [
            _chip('All', ''),
            for (final c in _categories) _chip('${c['name']}', '${c['id']}'),
          ]),
        ),
        const AdBanner(placement: 'top'),
        if (_promotion != null) HomepagePromotionBanner(banner: _promotion!),
        if (_loading)
          _skeletons()
        else if (_error != null)
          _errorState()
        else if (_videos.isEmpty)
          _emptyState(filtering)
        else ...[
          if (!filtering) ...[
            _featured(),
            ..._trending(),
            const AdBanner(placement: 'middle'),
            ..._collections(),
            ..._creators(),
          ] else
            ..._collections(title: 'Series & playlists'),
          _heading(filtering ? 'Results' : 'All videos', Icons.grid_view_rounded),
          _grid(),
          const AdBanner(placement: 'bottom'),
        ],
      ]),
    );
  }

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
              child: Row(children: [
                if (active) const Padding(padding: EdgeInsets.only(right: 6), child: Icon(Icons.check, size: 16)),
                Text(label, style: TextStyle(fontSize: 13, fontWeight: active ? FontWeight.w700 : FontWeight.w500)),
              ]),
            ),
          ),
        ),
      ),
    );
  }

  List<Map<String, dynamic>> get _featuredVideos {
    final picked = _videos.where((v) => v['featured'] == true && v['isSponsored'] != true).toList();
    final byViews = _videos.where((v) => v['isSponsored'] != true).toList()..sort((a, b) => _views(b).compareTo(_views(a)));
    for (final v in byViews) {
      if (picked.length >= 4) break;
      if (!picked.contains(v)) picked.add(v);
    }
    return picked.take(4).toList();
  }

  Widget _featured() {
    final items = _featuredVideos;
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 4),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: SizedBox(
          height: 190,
          child: Stack(children: [
            PageView.builder(
              controller: _pager,
              itemCount: items.length,
              onPageChanged: (i) => setState(() => _featuredIndex = i),
              itemBuilder: (_, i) => _banner(items[i]),
            ),
            if (items.length > 1)
              Positioned(
                right: 14,
                bottom: 12,
                child: Row(children: [
                  for (var i = 0; i < items.length; i++)
                    AnimatedContainer(
                      duration: const Duration(milliseconds: 250),
                      margin: const EdgeInsets.only(left: 5),
                      width: i == _featuredIndex ? 16 : 6,
                      height: 6,
                      decoration: BoxDecoration(
                        color: i == _featuredIndex ? const Color(0xFFD946EF) : Colors.white38,
                        borderRadius: BorderRadius.circular(3),
                      ),
                    ),
                ]),
              ),
          ]),
        ),
      ),
    );
  }

  Widget _banner(Map<String, dynamic> v) {
    final thumb = assetUrl(v['thumbnailUrl'] as String?);
    final description = '${v['description'] ?? ''}'.trim();
    return GestureDetector(
      onTap: () => _openVideo(v),
      child: Stack(fit: StackFit.expand, children: [
        Container(color: kPanel),
        if (thumb.isNotEmpty) Image.network(thumb, fit: BoxFit.cover, errorBuilder: (_, _, _) => const SizedBox.shrink()),
        const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [Color(0xF208090E), Color(0xA008090E), Color(0x1A08090E)],
              stops: [0, .55, 1],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
              decoration: BoxDecoration(color: const Color(0x557C3AED), borderRadius: BorderRadius.circular(8)),
              child: const Text('FEATURED', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: .8)),
            ),
            const SizedBox(height: 8),
            FractionallySizedBox(
              widthFactor: .62,
              child: Text('${v['title'] ?? ''}', maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, height: 1.15)),
            ),
            if (description.isNotEmpty) ...[
              const SizedBox(height: 4),
              FractionallySizedBox(
                widthFactor: .6,
                child: Text(description, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xFFC9C7D7))),
              ),
            ],
            const SizedBox(height: 12),
            Row(children: [
              GradientButton(
                onPressed: () => _openVideo(v),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 9),
                child: const Row(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.play_arrow_rounded, size: 20),
                  SizedBox(width: 4),
                  Text('Play Now', style: TextStyle(fontWeight: FontWeight.w700)),
                ]),
              ),
            ]),
          ]),
        ),
      ]),
    );
  }

  Widget _heading(String text, IconData icon, {Color color = kPurple}) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 8),
        child: Row(children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(width: 8),
          Text(text, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
        ]),
      );

  List<Widget> _trending() {
    final top = _videos.where((v) => _views(v) > 0).toList()..sort((a, b) => _views(b).compareTo(_views(a)));
    final items = top.take(10).toList();
    if (items.isEmpty) return const [];
    return [
      _heading('Trending now', Icons.local_fire_department, color: const Color(0xFFFF7A3D)),
      SizedBox(
        height: 215,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          physics: const BouncingScrollPhysics(),
          itemCount: items.length,
          separatorBuilder: (_, _) => const SizedBox(width: 10),
          itemBuilder: (_, i) => SizedBox(
            width: 210,
            child: VideoCard(video: items[i], onTap: () => _openVideo(items[i]), onCreator: _creatorOf(items[i]) == null ? null : () => _openCreator(_creatorOf(items[i])!)),
          ),
        ),
      ),
    ];
  }

  List<Widget> _collections({String title = 'Web series & playlists'}) {
    final groups = VideoCollection.group(_videos);
    if (groups.isEmpty) return const [];
    return [
      _heading(title, Icons.playlist_play_rounded, color: const Color(0xFF38BDF8)),
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
            child: CollectionCard(collection: groups[i], onTap: () => _push(CollectionScreen(collection: groups[i]))),
          ),
        ),
      ),
    ];
  }

  List<Widget> _creators() {
    if (_popular.isEmpty) return const [];
    return [
      _heading('Popular creators', Icons.star_rounded, color: const Color(0xFFD946EF)),
      SizedBox(
        height: 112,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          physics: const BouncingScrollPhysics(),
          itemCount: _popular.length,
          separatorBuilder: (_, _) => const SizedBox(width: 14),
          itemBuilder: (_, i) {
            final c = _popular[i];
            final photo = '${c['profilePhotoUrl'] ?? ''}';
            final followers = (c['followerCount'] as num?) ?? 0;
            return InkWell(
              borderRadius: BorderRadius.circular(12),
              onTap: () => _openCreator(c),
              child: SizedBox(
                width: 74,
                child: Column(children: [
                  Container(
                    padding: const EdgeInsets.all(2.5),
                    decoration: const BoxDecoration(shape: BoxShape.circle, gradient: kGradient),
                    child: CircleAvatar(
                      radius: 28,
                      backgroundColor: kPanel,
                      backgroundImage: photo.isEmpty ? null : NetworkImage(assetUrl(photo)),
                      child: photo.isEmpty ? const Icon(Icons.person) : null,
                    ),
                  ),
                  const SizedBox(height: 5),
                  Text('${c['displayName'] ?? c['username']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  Text('$followers followers', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 10, color: kMuted)),
                ]),
              ),
            );
          },
        ),
      ),
    ];
  }

  Widget _grid() {
    return LayoutBuilder(builder: (context, box) {
      final columns = box.maxWidth < 600 ? 2 : box.maxWidth < 900 ? 3 : box.maxWidth < 1200 ? 4 : 5;
      const gap = 10.0;
      final width = (box.maxWidth - gap * (columns + 1)) / columns;
      return Padding(
        padding: const EdgeInsets.all(gap),
        child: Wrap(spacing: gap, runSpacing: gap, children: [
          for (final v in _videos)
            SizedBox(
              width: width,
              child: VideoCard(video: v, onTap: () => _openVideo(v), onCreator: _creatorOf(v) == null ? null : () => _openCreator(_creatorOf(v)!)),
            ),
        ]),
      );
    });
  }

  Widget _skeletons() => const Padding(
        padding: EdgeInsets.fromLTRB(14, 14, 14, 0),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Skeleton(height: 190, radius: 18),
          SizedBox(height: 22),
          Skeleton(width: 130, height: 18),
          SizedBox(height: 10),
          Row(children: [
            Expanded(child: Skeleton(height: 115)),
            SizedBox(width: 10),
            Expanded(child: Skeleton(height: 115)),
          ]),
          SizedBox(height: 10),
          Skeleton(width: 150, height: 12),
        ]),
      );

  Widget _errorState() => Padding(
        padding: const EdgeInsets.all(32),
        child: Column(children: [
          const Icon(Icons.wifi_off_rounded, size: 40, color: kMuted),
          const SizedBox(height: 10),
          Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: kMuted)),
          const SizedBox(height: 14),
          GradientButton(onPressed: _load, child: const Text('Retry', style: TextStyle(fontWeight: FontWeight.w700))),
        ]),
      );

  Widget _emptyState(bool filtering) => Padding(
        padding: const EdgeInsets.all(48),
        child: Column(children: [
          const Icon(Icons.video_library_outlined, size: 40, color: kMuted),
          const SizedBox(height: 10),
          Text(filtering ? 'No videos match your search.' : 'No videos yet. Check back soon.', textAlign: TextAlign.center, style: const TextStyle(color: kMuted)),
        ]),
      );

  Widget _explore() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        const Text('Popular creators', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
        const SizedBox(height: 8),
        if (_loading)
          const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
        else if (_popular.isEmpty)
          const Padding(padding: EdgeInsets.all(24), child: Text('No creators yet.', style: TextStyle(color: kMuted))),
        for (var i = 0; i < _popular.length; i++)
          ListTile(
            leading: CircleAvatar(
              backgroundImage: '${_popular[i]['profilePhotoUrl'] ?? ''}'.isEmpty ? null : NetworkImage(assetUrl('${_popular[i]['profilePhotoUrl']}')),
              child: '${_popular[i]['profilePhotoUrl'] ?? ''}'.isEmpty ? const Icon(Icons.person) : null,
            ),
            title: Text('${i + 1}. ${_popular[i]['displayName'] ?? _popular[i]['username']}'),
            subtitle: Text('${_popular[i]['followerCount']} followers', style: const TextStyle(color: kMuted)),
            onTap: () => _openCreator(_popular[i]),
          ),
      ]),
    );
  }

  Widget _bottomBar() {
    return Container(
      decoration: const BoxDecoration(color: Color(0xFF0B0C14), border: Border(top: BorderSide(color: Color(0x14FFFFFF)))),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: 66,
          child: Row(children: [
            _navItem(Icons.home_rounded, Icons.home_outlined, 'Home', _tab == 0, () => setState(() => _tab = 0)),
            _navItem(Icons.video_collection, Icons.video_collection_outlined, 'Simply', _tab == 1, () => setState(() => _tab = 1)),
            Expanded(
              child: Center(
                child: GradientButton(
                  onPressed: _create,
                  radius: 16,
                  padding: const EdgeInsets.all(12),
                  child: const Column(mainAxisSize: MainAxisSize.min, children: [Icon(Icons.add, size: 24), Text('Create', style: TextStyle(fontSize: 10))]),
                ),
              ),
            ),
            _navItem(Icons.account_balance_wallet, Icons.account_balance_wallet_outlined, 'Earn', false, _earn),
            _navItem(Icons.person, Icons.person_outline, 'Profile', false, _profile),
          ]),
        ),
      ),
    );
  }

  Widget _navItem(IconData active, IconData idle, String label, bool selected, VoidCallback onTap) {
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
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              Icon(selected ? active : idle, color: color, size: 24),
              const SizedBox(height: 2),
              Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: selected ? FontWeight.w700 : FontWeight.w500)),
            ]),
          ),
        ),
      ),
    );
  }
}
