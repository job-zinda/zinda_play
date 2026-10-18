import 'package:flutter/material.dart';

import '../api.dart';

class WalletScreen extends StatefulWidget {
  const WalletScreen({super.key});
  @override
  State<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends State<WalletScreen> {
  Map<String, dynamic>? _wallet;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await Api.instance.get('/creator/wallet');
      if (!mounted) return;
      setState(() {
        _wallet = Map<String, dynamic>.from(data as Map);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _loading = false; });
    }
  }

  String _rupees(dynamic v) => '₹${((v as num?) ?? 0).toStringAsFixed(2)}';

  @override
  Widget build(BuildContext context) {
    final w = _wallet;
    final videos = w == null ? <Map<String, dynamic>>[] : (w['videos'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Creator wallet')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : w == null
              ? Center(child: Text(_error ?? 'Could not load the wallet.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(padding: const EdgeInsets.all(12), children: [
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(children: [
                          const Text('Estimated earnings', style: TextStyle(color: Colors.white60)),
                          const SizedBox(height: 4),
                          Text(_rupees(w['estimatedEarningsRupees']), style: const TextStyle(fontSize: 32, fontWeight: FontWeight.w800)),
                          const SizedBox(height: 12),
                          Text('Regular videos: ${_rupees(w['rateRupees'])} per ${w['rateViews']} qualifying views.'),
                          if (w['simplyRateRupees'] != null) ...[
                            Text('Simply: ${_rupees(w['simplyRateRupees'])} per ${w['simplyRateViews']} qualifying views.'),
                            const Text('Simply earns proportionally from new qualifying views only. Earlier views do not earn retroactively. Previously earned regular-view amounts are retained. Amounts are rounded for display.', style: TextStyle(color: Colors.white60)),
                          ],
                          const SizedBox(height: 12),
                          Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                            _stat('${w['totalViews']}', 'Total views'),
                            _stat('${w['eligibleViews']}', 'Unique views'),
                          ]),
                        ]),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text('Earnings by video', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
                    if (videos.isEmpty) const Padding(padding: EdgeInsets.all(24), child: Text('No videos yet.')),
                    for (final v in videos)
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text('${v['title']}', maxLines: 1, overflow: TextOverflow.ellipsis),
                        subtitle: Text('${v['videoType'] == 'short' ? 'Simply · ' : ''}${v['totalViews']} views · ${v['eligibleViews']} qualifying'),
                        trailing: Text(_rupees(v['estimatedEarningsRupees']), style: const TextStyle(fontWeight: FontWeight.w700)),
                      ),
                  ]),
                ),
    );
  }

  Widget _stat(String value, String label) => Column(children: [
        Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        Text(label, style: const TextStyle(color: Colors.white60)),
      ]);
}
