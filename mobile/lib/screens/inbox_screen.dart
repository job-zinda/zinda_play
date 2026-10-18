import 'package:flutter/material.dart';

import '../api.dart';
import 'admin_chat_screen.dart';

class InboxScreen extends StatefulWidget {
  const InboxScreen({super.key});
  @override
  State<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends State<InboxScreen> {
  List<Map<String, dynamic>> _notifications = [];
  Map<String, Map<String, dynamic>> _invitations = {};
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Map<String, dynamic> _map(dynamic v) => Map<String, dynamic>.from(v as Map);

  Future<void> _load() async {
    try {
      final r = await Future.wait([Api.instance.get('/notifications'), Api.instance.get('/creator/invitations')]);
      if (!mounted) return;
      setState(() {
        _notifications = ((r[0] as Map)['notifications'] as List).map(_map).toList();
        _invitations = {for (final i in (r[1] as List).map(_map)) '${i['id']}': i};
        _loading = false;
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() { _error = '$e'; _loading = false; });
    }
  }

  Future<void> _markRead(Map<String, dynamic> n) async {
    if (n['readAt'] != null) return;
    try {
      await Api.instance.post('/notifications/${n['id']}/read');
      setState(() => n['readAt'] = DateTime.now().toIso8601String());
    } catch (_) {}
  }

  Future<void> _respond(String invitationId, String status) async {
    try {
      await Api.instance.patch('/creator/invitations/$invitationId', {'status': status});
      await _load();
      if (status == 'accepted' && mounted) {
        Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminChatScreen()));
      }
    } catch (e) {
      setState(() => _error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton.icon(
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminChatScreen())),
            icon: const Icon(Icons.chat_bubble_outline),
            label: const Text('Admin chat'),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(padding: const EdgeInsets.all(12), children: [
                if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(_error!, style: const TextStyle(color: Colors.redAccent))),
                if (_notifications.isEmpty) const Padding(padding: EdgeInsets.all(48), child: Center(child: Text('No notifications yet.'))),
                for (final n in _notifications) _tile(n),
              ]),
            ),
    );
  }

  Widget _tile(Map<String, dynamic> n) {
    final unread = n['readAt'] == null;
    final invitation = _invitations['${n['invitationId']}'];
    final pending = n['type'] == 'brand_invitation' && invitation?['status'] == 'pending';
    final chatType = n['type'] == 'admin_message' || n['type'] == 'creator_chat';
    return Card(
      child: InkWell(
        onTap: () => _markRead(n),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              if (unread) const Padding(padding: EdgeInsets.only(right: 8), child: Icon(Icons.circle, size: 8, color: Color(0xFFFF4D6D))),
              Expanded(child: Text('${n['title']}', style: const TextStyle(fontWeight: FontWeight.w700))),
            ]),
            const SizedBox(height: 4),
            Text('${n['message']}'),
            if (n['type'] == 'brand_invitation' && invitation != null && !pending)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('You ${invitation['status']} this invitation.', style: const TextStyle(color: Colors.white60)),
              ),
            if (pending)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Row(children: [
                  FilledButton(onPressed: () => _respond('${n['invitationId']}', 'accepted'), child: const Text("I'm interested")),
                  const SizedBox(width: 8),
                  OutlinedButton(onPressed: () => _respond('${n['invitationId']}', 'declined'), child: const Text('Not interested')),
                ]),
              ),
            if (chatType || n['type'] == 'brand_invitation' && !pending)
              TextButton(
                onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const AdminChatScreen())),
                child: const Text('Reply'),
              ),
          ]),
        ),
      ),
    );
  }
}
