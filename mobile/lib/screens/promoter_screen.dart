import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../public_links.dart';
import 'studio_screen.dart';
import 'account_screen.dart';
import 'wallet_screen.dart';

class PromoterScreen extends StatefulWidget {
  const PromoterScreen({super.key});
  @override
  State<PromoterScreen> createState() => _PromoterScreenState();
}

class _PromoterScreenState extends State<PromoterScreen> {
  Map<String, dynamic>? _w;
  bool _loading = true;
  String? _error, _message;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await Api.instance.get('/promoter/wallet');
      if (!mounted) return;
      setState(() {
        _w = Map<String, dynamic>.from(data as Map);
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _loading = false;
        });
      }
    }
  }

  String _rupees(dynamic v) => '₹${((v as num?) ?? 0).toStringAsFixed(2)}';
  bool _switching = false;

  Future<void> _switchToCreator() async {
    setState(() {
      _switching = true;
      _error = null;
    });
    try {
      final result = await Api.instance.switchMode('creator');
      if (!mounted) return;
      if (result['role'] == 'creator') {
        await Navigator.pushReplacement(
          context,
          MaterialPageRoute<void>(builder: (_) => const StudioScreen()),
        );
      } else {
        await Navigator.pushReplacement(
          context,
          MaterialPageRoute<void>(builder: (_) => const AccountScreen()),
        );
      }
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _switching = false);
    }
  }

  Future<void> _withdraw() async {
    final handle = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Request withdrawal'),
        content: TextField(
          controller: handle,
          decoration: const InputDecoration(
            labelText: 'UPI ID or UPI mobile number',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Request'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await Api.instance.post('/promoter/withdrawals', {
        'payoutHandle': handle.text.trim(),
      });
      _message = 'Withdrawal requested. The admin will review it.';
      await _load();
    } catch (e) {
      setState(() {
        _error = '$e';
        _message = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final w = _w;
    final settings = w?['rewardSettings'] as Map?;
    final watchRate = settings?['memberWatch'] as Map?;
    final referralRate = settings?['referralViews'] as Map?;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Wallet & referrals'),
        actions: [
          IconButton(
            tooltip: 'Profile & account settings',
            icon: const Icon(Icons.manage_accounts_outlined),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AccountScreen()),
            ),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : w == null
          ? Center(child: Text(_error ?? 'Could not load.'))
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                padding: const EdgeInsets.all(12),
                children: [
                  if (_error != null)
                    Card(
                      color: Colors.red.withValues(alpha: 0.18),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(_error!),
                      ),
                    ),
                  if (_message != null)
                    Card(
                      color: Colors.green.withValues(alpha: 0.18),
                      child: Padding(
                        padding: const EdgeInsets.all(12),
                        child: Text(_message!),
                      ),
                    ),
                  OutlinedButton.icon(
                    onPressed: _switching ? null : _switchToCreator,
                    icon: const Icon(Icons.swap_horiz),
                    label: Text(
                      _switching
                          ? 'Opening...'
                          : Api.instance.role == 'creator'
                          ? 'Creator studio'
                          : 'Apply for creator access',
                    ),
                  ),
                  const Text(
                    'Member rewards need no approval. Creator access still requires a profile photo, admin approval and the normal trial/membership flow. Your rewards and withdrawal history stay on this account.',
                  ),
                  if (Api.instance.role == 'creator')
                    TextButton.icon(
                      onPressed: () => Navigator.push(
                        context,
                        MaterialPageRoute<void>(
                          builder: (_) => const WalletScreen(),
                        ),
                      ),
                      icon: const Icon(Icons.account_balance_wallet_outlined),
                      label: const Text('Creator earnings'),
                    ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          const Text(
                            'Available to withdraw',
                            style: TextStyle(color: Colors.white60),
                          ),
                          Text(
                            _rupees(w['availableRupees']),
                            style: const TextStyle(
                              fontSize: 32,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            'Earned ${_rupees(w['earnedRupees'])} · Paid ${_rupees(w['paidRupees'])} · Pending ${_rupees(w['pendingRupees'])}',
                            style: const TextStyle(
                              color: Colors.white60,
                              fontSize: 12,
                            ),
                          ),
                          const SizedBox(height: 8),
                          FilledButton(
                            onPressed: (w['availableRupees'] as num) >= 100
                                ? _withdraw
                                : null,
                            child: const Text('Withdraw (min ₹100)'),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Your referral code',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                          SelectableText('${w['referralCode']}'),
                          SelectableText(referralUrl('${w['referralCode']}')),
                          TextButton.icon(
                            onPressed: () => sharePublicLink(
                              context,
                              'Join me on Zinda Play',
                              referralUrl('${w['referralCode']}'),
                            ),
                            icon: const Icon(Icons.share),
                            label: const Text('Share invitation'),
                          ),
                          TextButton.icon(
                            onPressed: () => copyPublicLink(
                              context,
                              referralUrl('${w['referralCode']}'),
                            ),
                            icon: const Icon(Icons.link),
                            label: const Text('Copy invitation link'),
                          ),
                          TextButton.icon(
                            onPressed: () async {
                              await Clipboard.setData(
                                ClipboardData(text: '${w['referralCode']}'),
                              );
                              if (mounted) {
                                setState(
                                  () => _message = 'Referral code copied.',
                                );
                              }
                            },
                            icon: const Icon(Icons.copy),
                            label: const Text('Copy code'),
                          ),
                          const Divider(),
                          if (watchRate != null && referralRate != null) ...[
                            Text(
                              watchRate['enabled'] == false
                                  ? 'Personal-watch rewards: paused.'
                                  : 'Personal watches: ${_rupees(watchRate['rateRupees'])} per 1,000 distinct eligible videos.',
                            ),
                            Text(
                              referralRate['enabled'] == false
                                  ? 'Referral rewards: paused.'
                                  : 'Referral views: ${_rupees(referralRate['rateRupees'])} per 1,000 qualifying views from people who joined through your referral.',
                            ),
                            const Text(
                              'Credited proportionally for each new qualifying watch. Members and creators both qualify without creator approval. Rate changes and pauses never change previously credited earnings.',
                            ),
                            const SizedBox(height: 8),
                          ] else
                            const Text(
                              'Current reward rates are unavailable. Update the backend and refresh.',
                            ),
                          Text('Referred views: ${w['referredViews']}'),
                          const SizedBox(height: 4),
                          Text(
                            'Distinct eligible videos watched: ${w['distinctVideosWatched']}',
                          ),
                          const Text(
                            'Personal and referral watches require signed-in, visible playback for 30 seconds (or the full video if shorter). Each viewer counts once per eligible regular video.',
                          ),
                        ],
                      ),
                    ),
                  ),
                  const Text(
                    'Withdrawals',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                  if ((w['withdrawals'] as List).isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('No withdrawals yet.'),
                    ),
                  for (final x in (w['withdrawals'] as List))
                    ListTile(
                      contentPadding: EdgeInsets.zero,
                      title: Text(_rupees(x['amountRupees'])),
                      subtitle: Text(
                        '${x['payoutHandle']} · ${x['createdAt'].toString().split('T').first}',
                      ),
                      trailing: Text('${x['status']}'),
                    ),
                ],
              ),
            ),
    );
  }
}
