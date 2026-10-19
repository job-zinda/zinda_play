import 'package:flutter/material.dart';

import '../api.dart';

String _rupees(dynamic value) =>
    '₹${((value as num?) ?? 0).toStringAsFixed(2)}';

String _date(dynamic value) {
  final parsed = DateTime.tryParse('${value ?? ''}')?.toLocal();
  if (parsed == null) return '';
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(parsed.day)}/${two(parsed.month)}/${parsed.year}';
}

/// Balance, Withdraw button and withdrawal history for the creator wallet.
class WithdrawCard extends StatelessWidget {
  const WithdrawCard({
    super.key,
    required this.wallet,
    required this.onChanged,
  });

  final Map<String, dynamic> wallet;
  final Future<void> Function() onChanged;

  @override
  Widget build(BuildContext context) {
    final minimum = (wallet['minimumWithdrawalRupees'] as num?) ?? 100;
    final available = (wallet['availableRupees'] as num?) ?? 0;
    final pending = wallet['hasPendingWithdrawal'] == true;
    final canWithdraw = wallet['canWithdraw'] == true;
    final shortBy = minimum - available;
    final withdrawals = ((wallet['withdrawals'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    final credits = ((wallet['credits'] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Available to withdraw',
              style: TextStyle(color: Colors.white60),
            ),
            Text(
              _rupees(available),
              key: const Key('withdraw-available'),
              style: const TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.w800,
                color: Color(0xFF86EFAC),
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 16,
              runSpacing: 4,
              children: [
                Text('Withdrawn ${_rupees(wallet['withdrawnRupees'])}'),
                Text('Pending ${_rupees(wallet['pendingWithdrawalRupees'])}'),
                if (((wallet['adminCreditsRupees'] as num?) ?? 0) > 0)
                  Text(
                    'Added by admin ${_rupees(wallet['adminCreditsRupees'])}',
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              pending
                  ? 'Your withdrawal request is waiting for the admin.'
                  : shortBy > 0
                  ? 'Minimum withdrawal is ₹$minimum. Earn ${_rupees(shortBy)} more to withdraw.'
                  : 'Minimum withdrawal is ₹$minimum. Withdraw the full balance or a custom amount.',
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                key: const Key('withdraw-button'),
                onPressed: canWithdraw
                    ? () async {
                        final done = await showWithdrawSheet(context, wallet);
                        if (done == true) await onChanged();
                      }
                    : null,
                icon: const Icon(Icons.account_balance_wallet_outlined),
                label: const Text('Withdraw'),
              ),
            ),
            if (withdrawals.isNotEmpty) ...[
              const SizedBox(height: 16),
              const Text(
                'Withdrawal history',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              for (final item in withdrawals)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(
                    '${_rupees(item['amountRupees'])} · ${item['payoutAppLabel']} ${item['payoutNumber']}',
                  ),
                  subtitle: Text(
                    'Requested ${_date(item['createdAt'])}'
                    '${item['paidAt'] != null ? ' · Paid ${_date(item['paidAt'])}' : ''}'
                    '${(item['rejectionReason'] ?? '').toString().isNotEmpty ? '\nReason: ${item['rejectionReason']}' : ''}',
                  ),
                  trailing: _StatusChip(status: '${item['status']}'),
                ),
            ],
            if (credits.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Text(
                'Added by admin',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
              for (final item in credits)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text('+${_rupees(item['amountRupees'])}'),
                  subtitle: Text(
                    [
                      _date(item['createdAt']),
                      if ((item['note'] ?? '').toString().isNotEmpty)
                        '${item['note']}',
                    ].join(' · '),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      'paid' => Colors.green,
      'rejected' => Colors.redAccent,
      _ => Colors.amber,
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(status, style: TextStyle(color: color, fontSize: 12)),
    );
  }
}

/// Returns true when a withdrawal request was sent.
Future<bool?> showWithdrawSheet(
  BuildContext context,
  Map<String, dynamic> wallet,
) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => _WithdrawSheet(wallet: wallet),
  );
}

class _WithdrawSheet extends StatefulWidget {
  const _WithdrawSheet({required this.wallet});
  final Map<String, dynamic> wallet;

  @override
  State<_WithdrawSheet> createState() => _WithdrawSheetState();
}

class _WithdrawSheetState extends State<_WithdrawSheet> {
  final _number = TextEditingController();
  final _amount = TextEditingController();
  bool _custom = false;
  String _app = 'gpay';
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _number.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await Api.instance.post('/creator/withdrawals', {
        'payoutApp': _app,
        'payoutNumber': _number.text.trim(),
        if (_custom) 'amountRupees': _amount.text.trim(),
      });
      if (!mounted) return;
      final data = Map<String, dynamic>.from(result as Map);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Withdrawal of ${_rupees(data['amountRupees'])} requested. The admin will pay it to your ${data['payoutAppLabel']}.',
          ),
        ),
      );
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _saving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final available = (widget.wallet['availableRupees'] as num?) ?? 0;
    final minimum = (widget.wallet['minimumWithdrawalRupees'] as num?) ?? 100;
    final appName = _app == 'gpay' ? 'Google Pay' : 'PhonePe';
    return Padding(
      padding: EdgeInsets.fromLTRB(
        16,
        16,
        16,
        16 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Withdraw money',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 12),
            const Text('Amount', style: TextStyle(color: Colors.white60)),
            SegmentedButton<bool>(
              segments: [
                ButtonSegment(
                  value: false,
                  label: Text('Full ${_rupees(available)}'),
                ),
                const ButtonSegment(value: true, label: Text('Custom')),
              ],
              selected: {_custom},
              onSelectionChanged: (v) => setState(() => _custom = v.first),
            ),
            if (_custom) ...[
              const SizedBox(height: 8),
              TextField(
                key: const Key('withdraw-amount'),
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(
                  decimal: true,
                ),
                decoration: InputDecoration(
                  labelText: 'Amount (₹$minimum – ${_rupees(available)})',
                  prefixText: '₹ ',
                ),
              ),
            ],
            const SizedBox(height: 16),
            const Text('Pay me on', style: TextStyle(color: Colors.white60)),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'gpay', label: Text('Google Pay')),
                ButtonSegment(value: 'phonepe', label: Text('PhonePe')),
              ],
              selected: {_app},
              onSelectionChanged: (v) => setState(() => _app = v.first),
            ),
            const SizedBox(height: 8),
            TextField(
              key: const Key('withdraw-number'),
              controller: _number,
              keyboardType: TextInputType.phone,
              maxLength: 14,
              decoration: InputDecoration(
                labelText: '$appName number',
                hintText: '98765 43210',
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                key: const Key('withdraw-submit'),
                onPressed: _saving ? null : _submit,
                child: Text(_saving ? 'Sending…' : 'Request withdrawal'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
