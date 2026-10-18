import 'package:flutter/material.dart';

import '../api.dart';
import '../widgets/video_card.dart';
import 'auth_screen.dart';
import 'business_screen.dart';
import 'creator_screen.dart';
import 'promoter_screen.dart';
import 'inbox_screen.dart';
import 'studio_screen.dart';
import 'watch_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final _search = TextEditingController();
  List<Map<String, dynamic>> _videos = [];
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _popular = [];
  String _category = '';
  bool _loading = true;
  String? _error;
  int _tab = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  List<Map<String, dynamic>> _list(dynamic data) =>
      (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();

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
      ]);
      if (!mounted) return;
      setState(() {
        _videos = _list(results[0]);
        _categories = _list(results[1]);
        _popular = _list(results[2]);
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

  void _openVideo(Map<String, dynamic> video) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => WatchScreen(video: video)));

  void _openCreator(Map<String, dynamic> creator) =>
      Navigator.push(context, MaterialPageRoute(builder: (_) => CreatorScreen(creator: creator)));

  Future<void> _account() async {
    if (!Api.instance.signedIn) {
      await Navigator.push(context, MaterialPageRoute(builder: (_) => const AuthScreen()));
    } else {
      await Api.instance.logout();
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final signedIn = Api.instance.signedIn;
    return Scaffold(
      appBar: AppBar(
        title: Image.asset('assets/banner.png', height: 34, semanticLabel: 'Zinda Play'),
        actions: [
          if (signedIn && Api.instance.role == 'business')
            IconButton(
              tooltip: 'Business dashboard',
              icon: const Icon(Icons.business_center),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BusinessScreen())),
            ),
          if (signedIn && Api.instance.role == 'promoter')
            IconButton(
              tooltip: 'Promoter dashboard',
              icon: const Icon(Icons.campaign),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const PromoterScreen())),
            ),
          if (signedIn && Api.instance.role == 'creator')
            IconButton(
              tooltip: 'Notifications',
              icon: const Icon(Icons.notifications_none),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const InboxScreen())),
            ),
          if (signedIn && Api.instance.role == 'creator')
            IconButton(
              tooltip: 'Creator studio',
              icon: const Icon(Icons.video_library),
              onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const StudioScreen())),
            ),
          TextButton.icon(
            onPressed: _account,
            icon: Icon(signedIn ? Icons.logout : Icons.login),
            label: Text(signedIn ? Api.instance.username ?? 'Sign out' : 'Sign in'),
          ),
        ],
      ),
      body: _tab == 0 ? _home() : _explore(),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.explore_outlined), selectedIcon: Icon(Icons.explore), label: 'Explore'),
        ],
      ),
    );
  }

  Widget _home() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(children: [
        Padding(
          padding: const EdgeInsets.all(12),
          child: TextField(
            controller: _search,
            textInputAction: TextInputAction.search,
            onSubmitted: (_) => _load(),
            decoration: InputDecoration(
              hintText: 'Search videos',
              prefixIcon: const Icon(Icons.search),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(24)),
              isDense: true,
            ),
          ),
        ),
        SizedBox(
          height: 44,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
            _chip('All', ''),
            for (final c in _categories) _chip('${c['name']}', '${c['id']}'),
          ]),
        ),
        if (_loading)
          const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
        else if (_error != null)
          Padding(
            padding: const EdgeInsets.all(32),
            child: Column(children: [
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(onPressed: _load, child: const Text('Retry')),
            ]),
          )
        else if (_videos.isEmpty)
          const Padding(padding: EdgeInsets.all(48), child: Center(child: Text('No videos found.')))
        else ...[
          if (_search.text.trim().isEmpty && _category.isEmpty) ..._highlights(),
          _heading('All videos'),
          _grid(),
        ],
      ]),
    );
  }

  Widget _heading(String text) => Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
        child: Text(text, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      );

  List<Widget> _highlights() {
    final trending = [..._videos]..sort((a, b) => ((b['views'] as num?) ?? 0).compareTo((a['views'] as num?) ?? 0));
    final top = trending.where((v) => ((v['views'] as num?) ?? 0) > 0).take(10).toList();
    return [
      if (top.isNotEmpty) ...[
        _heading('Trending videos'),
        SizedBox(
          height: 175,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: top.length,
            separatorBuilder: (_, _) => const SizedBox(width: 8),
            itemBuilder: (_, i) => SizedBox(
              width: 170,
              child: VideoCard(
                video: top[i],
                onTap: () => _openVideo(top[i]),
                onCreator: top[i]['creatorProfile'] == null ? null : () => _openCreator(Map<String, dynamic>.from(top[i]['creatorProfile'] as Map)),
              ),
            ),
          ),
        ),
      ],
      if (_popular.isNotEmpty) ...[
        _heading('Popular creators'),
        SizedBox(
          height: 92,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            itemCount: _popular.length,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (_, i) {
              final c = _popular[i];
              final photo = '${c['profilePhotoUrl'] ?? ''}';
              return InkWell(
                onTap: () => _openCreator(c),
                child: SizedBox(
                  width: 72,
                  child: Column(children: [
                    CircleAvatar(
                      radius: 28,
                      backgroundImage: photo.isEmpty ? null : NetworkImage(assetUrl(photo)),
                      child: photo.isEmpty ? const Icon(Icons.person) : null,
                    ),
                    const SizedBox(height: 4),
                    Text('${c['displayName'] ?? c['username']}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11)),
                  ]),
                ),
              );
            },
          ),
        ),
      ],
    ];
  }

  Widget _grid() {
    return LayoutBuilder(builder: (context, box) {
      final columns = box.maxWidth < 600 ? 2 : box.maxWidth < 900 ? 3 : box.maxWidth < 1200 ? 4 : 5;
      const gap = 8.0;
      final width = (box.maxWidth - gap * (columns + 1)) / columns;
      return Padding(
        padding: const EdgeInsets.all(gap),
        child: Wrap(spacing: gap, runSpacing: gap, children: [
          for (final v in _videos)
            SizedBox(
              width: width,
              child: VideoCard(
                video: v,
                onTap: () => _openVideo(v),
                onCreator: v['creatorProfile'] == null ? null : () => _openCreator(Map<String, dynamic>.from(v['creatorProfile'] as Map)),
              ),
            ),
        ]),
      );
    });
  }

  Widget _chip(String label, String id) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4),
        child: ChoiceChip(
          label: Text(label),
          selected: _category == id,
          onSelected: (_) {
            setState(() => _category = id);
            _load();
          },
        ),
      );

  Widget _explore() {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(12), children: [
        const Text('Popular creators', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        if (_popular.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No creators yet.')),
        for (var i = 0; i < _popular.length; i++)
          ListTile(
            leading: CircleAvatar(
              backgroundImage: _popular[i]['profilePhotoUrl'] == '' ? null : NetworkImage(assetUrl('${_popular[i]['profilePhotoUrl']}')),
              child: _popular[i]['profilePhotoUrl'] == '' ? const Icon(Icons.person) : null,
            ),
            title: Text('${i + 1}. ${_popular[i]['displayName'] ?? _popular[i]['username']}'),
            subtitle: Text('${_popular[i]['followerCount']} followers'),
            onTap: () => _openCreator(_popular[i]),
          ),
      ]),
    );
  }
}
