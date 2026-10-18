import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:video_player/video_player.dart';

import '../api.dart';

class BusinessAdsScreen extends StatefulWidget {
  const BusinessAdsScreen({super.key});

  @override
  State<BusinessAdsScreen> createState() => _BusinessAdsScreenState();
}

class _BusinessAdsScreenState extends State<BusinessAdsScreen> {
  final _api = Api.instance;
  final _formKey = GlobalKey<FormState>();
  final _title = TextEditingController();
  final _description = TextEditingController();
  final _url = TextEditingController();
  final _city = TextEditingController();
  final _views = TextEditingController(text: '1000');
  final _scroll = ScrollController();
  Map<String, dynamic>? _settings, _current;
  List<Map<String, dynamic>> _submissions = [], _categories = [];
  Set<String> _interests = {};
  File? _video, _proof;
  String? _videoType, _proofType, _error, _message;
  bool _busy = false, _dirty = false;
  double? _progress;

  Map<String, dynamic> _map(dynamic value) =>
      Map<String, dynamic>.from(value as Map);
  List<Map<String, dynamic>> _list(dynamic value) =>
      (value as List).map(_map).toList();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final controller in [_title, _description, _url, _city, _views]) {
      controller.dispose();
    }
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        _api.get('/business/ad-settings'),
        _api.get('/business/ads'),
        _api.get('/categories'),
      ]);
      if (!mounted) return;
      setState(() {
        _settings = _map(results[0]);
        _submissions = _list(results[1]);
        _categories = _list(results[2]);
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _act(Future<void> Function() action) async {
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
      _progress = null;
    });
    try {
      await action();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _progress = null;
        });
      }
    }
  }

  void _edit(Map<String, dynamic>? item) {
    setState(() {
      _current = item;
      _title.text = '${item?['title'] ?? ''}';
      _description.text = '${item?['description'] ?? ''}';
      _url.text = '${item?['targetUrl'] ?? ''}';
      _city.text = '${item?['targetCity'] ?? ''}';
      _views.text = '${item?['targetViews'] ?? 1000}';
      _interests = (item?['targetCategories'] as List? ?? [])
          .map((value) => '$value')
          .toSet();
      _video = null;
      _proof = null;
      _dirty = false;
      _error = null;
      _message = null;
    });
    if (_scroll.hasClients) {
      _scroll.animateTo(
        0,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOut,
      );
    }
  }

  Future<void> _pick(bool video) async {
    try {
      final picked = await FilePicker.pickFile(
        type: video ? FileType.video : FileType.image,
      );
      final path = picked?.path;
      if (path == null || !mounted) return;
      const types = {
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'webp': 'image/webp',
      };
      final type = types[path.split('.').last.toLowerCase()];
      final file = File(path);
      final size = await file.length();
      if (!mounted) return;
      if (type == null ||
          type.startsWith('video/') != video ||
          size == 0 ||
          size > (video ? 150 : 8) * 1024 * 1024) {
        setState(
          () => _error = video
              ? 'Choose MP4/WebM up to 150 MB.'
              : 'Choose JPEG/PNG/WebP up to 8 MB.',
        );
        return;
      }
      setState(() {
        if (video) {
          _video = file;
          _videoType = type;
          _dirty = true;
        } else {
          _proof = file;
          _proofType = type;
        }
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    await _act(() async {
      if (_video == null && _current?['hasVideo'] != true) {
        throw ApiException('Choose an ad video first.');
      }
      final body = {
        'title': _title.text.trim(),
        'description': _description.text.trim(),
        'targetUrl': _url.text.trim(),
        'targetCity': _city.text.trim(),
        'targetCategories': _interests.toList(),
        'targetViews': int.parse(_views.text),
        'cpmRupees': _settings!['cpmRupees'],
      };
      final current = _current;
      final draft = _map(
        current == null
            ? await _api.post('/business/ads', body)
            : await _api.patch('/business/ads/${current['id']}', body),
      );
      if (!mounted) return;
      setState(() => _current = draft);
      final video = _video;
      if (video != null) {
        final updated = _map(
          await _api.uploadFile(
            'PUT',
            '/business/ads/${draft['id']}/video',
            video,
            _videoType!,
            onProgress: (progress) {
              if (mounted) setState(() => _progress = progress);
            },
          ),
        );
        if (!mounted) return;
        setState(() {
          _current = updated;
          _video = null;
        });
      }
      if (!mounted) return;
      setState(() {
        _dirty = false;
        _message = 'Draft saved. Pay the quoted amount, upload proof and submit below.';
      });
      await _load();
    });
  }

  Future<void> _submit() async {
    await _act(() async {
      final current = _current!;
      if (_dirty) throw ApiException('Save changes before submitting.');
      if (current['paymentVerified'] != true && _proof != null) {
        await _api.uploadFile(
          'PUT',
          '/business/ads/${current['id']}/proof',
          _proof!,
          _proofType!,
        );
      }
      await _api.post('/business/ads/${current['id']}/submit');
      if (!mounted) return;
      _edit(null);
      setState(
        () => _message = 'Submitted for payment and content review. We will notify you when your ad is running.',
      );
      await _load();
    });
  }

  Future<void> _preview(Map<String, dynamic> item) async {
    await Navigator.push(
      context,
      MaterialPageRoute<void>(
        builder: (_) => _BusinessAdPreview(id: '${item['id']}'),
      ),
    );
  }

  String _names(Map<String, dynamic> item) {
    final ids = (item['targetCategories'] as List).map((id) => '$id');
    final names = ids
        .map(
          (id) =>
              _categories
                  .where((category) => category['id'] == id)
                  .firstOrNull?['name'] ??
              id,
        )
        .join(', ');
    return names.isEmpty ? 'All interests' : names;
  }

  @override
  Widget build(BuildContext context) {
    final settings = _settings;
    final current = _current;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Business ads & analytics'),
        actions: [
          IconButton(
            onPressed: _busy ? null : _load,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: settings == null
          ? Center(
              child: _error != null
                  ? Text(_error!)
                  : const CircularProgressIndicator(),
            )
          : ListView(
              controller: _scroll,
              padding: const EdgeInsets.all(16),
              children: [
                if (_error != null)
                  Text(
                    _error!,
                    style: const TextStyle(color: Colors.redAccent),
                  ),
                if (_message != null)
                  Text(
                    _message!,
                    style: const TextStyle(color: Colors.greenAccent),
                  ),
                if (_busy) LinearProgressIndicator(value: _progress),
                const Text(
                  'Upload + URL + city/interests, pay by QR, submit for review. Admin approval adds an unpublished ad; admin publishes it separately.',
                ),
                Text(
                  'Current price: INR ${settings['cpmRupees']} per 1000 impressions. Existing drafts keep their quoted price.',
                ),
                Form(
                  key: _formKey,
                  onChanged: () {
                    if (!_busy) setState(() => _dirty = true);
                  },
                  child: Column(
                    children: [
                      TextFormField(
                        controller: _title,
                        enabled: !_busy,
                        maxLength: 120,
                        decoration: const InputDecoration(
                          labelText: 'Ad title',
                        ),
                        validator: (value) =>
                            value!.trim().isEmpty ? 'Enter a title.' : null,
                      ),
                      TextFormField(
                        controller: _description,
                        enabled: !_busy,
                        maxLength: 2000,
                        maxLines: 3,
                        decoration: const InputDecoration(
                          labelText: 'Description',
                        ),
                      ),
                      TextFormField(
                        controller: _url,
                        enabled: !_busy,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          labelText: 'Destination URL',
                        ),
                        validator: (value) {
                          final url = Uri.tryParse(value!.trim());
                          return url == null ||
                                  !['http', 'https'].contains(url.scheme) ||
                                  url.host.isEmpty
                              ? 'Enter a valid http/https URL.'
                              : null;
                        },
                      ),
                      TextFormField(
                        controller: _city,
                        enabled: !_busy,
                        maxLength: 100,
                        decoration: const InputDecoration(
                          labelText: 'City (optional; blank = all locations)',
                        ),
                      ),
                      const Text('Interests (none selected = all interests)'),
                      Wrap(
                        spacing: 8,
                        children: _categories
                            .map(
                              (category) => FilterChip(
                                label: Text('${category['name']}'),
                                selected: _interests.contains(category['id']),
                                onSelected: _busy
                                    ? null
                                    : (selected) => setState(() {
                                        if (selected) {
                                          _interests.add('${category['id']}');
                                        } else {
                                          _interests.remove(category['id']);
                                        }
                                        _dirty = true;
                                      }),
                              ),
                            )
                            .toList(),
                      ),
                      TextFormField(
                        controller: _views,
                        enabled: !_busy && current == null,
                        keyboardType: TextInputType.number,
                        decoration: const InputDecoration(
                          labelText:
                              'Purchased impressions (multiples of 1000)',
                        ),
                        validator: (value) {
                          final count = int.tryParse(value ?? '');
                          return count == null ||
                                  count < 1000 ||
                                  count > 1000000 ||
                                  count % 1000 != 0
                              ? 'Choose 1000 to 1000000 in steps of 1000.'
                              : null;
                        },
                      ),
                      OutlinedButton(
                        onPressed: _busy ? null : () => _pick(true),
                        child: Text(
                          _video == null
                              ? 'Choose MP4/WebM video (max 150 MB)'
                              : 'Video selected - change',
                        ),
                      ),
                      if (current?['hasVideo'] == true)
                        const Text(
                          'Video already uploaded. Choose another to replace it.',
                        ),
                      Text(
                        'Quoted total: INR ${current?['amountRupees'] ?? ((int.tryParse(_views.text) ?? 1000) / 1000 * (settings['cpmRupees'] as num)).toStringAsFixed(0)}',
                      ),
                      FilledButton(
                        onPressed: _busy ? null : _save,
                        child: const Text('Save details & upload video'),
                      ),
                      if (current != null)
                        TextButton(
                          onPressed: _busy ? null : () => _edit(null),
                          child: const Text('Start another ad'),
                        ),
                    ],
                  ),
                ),
                if (current?['hasVideo'] == true) ...[
                  const Divider(),
                  Text(
                    'Payment & submission',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                  if (current!['paymentVerified'] == true)
                    Text(
                      'Payment of INR ${current['amountRupees']} verified and retained. Do not pay again.',
                    )
                  else ...[
                    Text(
                      'Pay exactly INR ${current['amountRupees']}. Verify the recipient before paying.',
                    ),
                    if (settings['qrUrl'] != null)
                      Center(
                        child: Container(
                          color: Colors.white,
                          padding: const EdgeInsets.all(12),
                          child: Image.network(
                            assetUrl(settings['qrUrl'] as String),
                            width: 260,
                            height: 260,
                            errorBuilder: (_, error, stack) => const Text(
                              'QR could not load. Refresh before paying.',
                              style: TextStyle(color: Colors.red),
                            ),
                          ),
                        ),
                      )
                    else
                      const Text(
                        'QR unavailable. Contact admin before paying.',
                      ),
                    OutlinedButton(
                      onPressed: _busy ? null : () => _pick(false),
                      child: Text(
                        _proof == null
                            ? 'Choose payment screenshot (max 8 MB)'
                            : 'Screenshot selected - change',
                      ),
                    ),
                    if (current['hasProof'] == true)
                      const Text('Payment screenshot already saved.'),
                  ],
                  if (_dirty)
                    const Text('Save your changes before submitting.'),
                  FilledButton(
                    onPressed:
                        _busy ||
                            _dirty ||
                            (current['paymentVerified'] != true &&
                                current['hasProof'] != true &&
                                _proof == null)
                        ? null
                        : _submit,
                    child: const Text('Submit paid ad for review'),
                  ),
                ],
                const Divider(),
                Text(
                  'Ad analytics & history',
                  style: Theme.of(context).textTheme.titleLarge,
                ),
                const Text(
                  'Impressions, clicks, CTR, remaining target and completion use the same delivery metrics as admin. Impressions are deliveries, not completed watches.',
                ),
                TextButton(
                  onPressed: _submissions.isEmpty
                      ? null
                      : () async {
                          final report = _submissions
                              .map(
                                (item) =>
                                    '${item['title']}: ${item['status']} / ${item['deliveryStatus'] ?? 'not published'}; ${item['impressions']}/${item['targetViews']} impressions; ${item['clicks']} clicks; CTR ${(item['clickThroughRate'] as num).toStringAsFixed(2)}%; ${item['remainingImpressions']} remaining; ${(item['completionPercent'] as num).toStringAsFixed(1)}% complete',
                              )
                              .join('\n');
                          await Clipboard.setData(ClipboardData(text: report));
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(
                              const SnackBar(
                                content: Text('Analytics report copied.'),
                              ),
                            );
                          }
                        },
                  child: const Text('Copy analytics report'),
                ),
                if (_submissions.isEmpty) const Text('No submissions yet.'),
                ..._submissions.map(
                  (item) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${item['title']}',
                            style: const TextStyle(fontWeight: FontWeight.bold),
                          ),
                          Text(
                            'Review: ${item['status']} / Delivery: ${item['deliveryStatus'] ?? 'not published'}',
                          ),
                          Text(
                            'Payment: ${item['paymentVerified'] == true ? 'verified' : 'not verified'} / INR ${item['amountRupees']}',
                          ),
                          Text(
                            '${item['targetCity'] == '' ? 'All locations' : item['targetCity']} / ${_names(item)}',
                          ),
                          Text(
                            '${item['impressions']}/${item['targetViews']} impressions / ${item['clicks']} clicks',
                          ),
                          Text(
                            'CTR ${(item['clickThroughRate'] as num).toStringAsFixed(2)}% / ${item['remainingImpressions']} remaining / ${(item['completionPercent'] as num).toStringAsFixed(1)}% complete',
                          ),
                          if (item['completedAt'] != null)
                            Text('Completed ${item['completedAt']}'),
                          if ('${item['rejectionReason']}'.isNotEmpty)
                            Text('Last rejection: ${item['rejectionReason']}'),
                          if ((item['history'] as List).isNotEmpty)
                            ExpansionTile(
                              title: const Text('Review history'),
                              children: [
                                for (final review in item['history'] as List)
                                  ListTile(
                                    title: Text(
                                      '${review['decision']} - ${review['reason']}',
                                    ),
                                    subtitle: Text('${review['reviewedAt']}'),
                                  ),
                              ],
                            ),
                          if (item['hasVideo'] == true)
                            TextButton(
                              onPressed: _busy ? null : () => _preview(item),
                              child: const Text('Preview video'),
                            ),
                          if (item['status'] == 'uploading')
                            const Text(
                              'Upload in progress. After an interruption, retry after 30 minutes.',
                            ),
                          if ([
                            'draft',
                            'rejected',
                            'uploading',
                          ].contains(item['status']))
                            FilledButton(
                              onPressed: _busy ? null : () => _edit(item),
                              child: Text(
                                item['status'] == 'rejected'
                                    ? 'Resubmit replacement'
                                    : 'Continue draft',
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _BusinessAdPreview extends StatefulWidget {
  final String id;
  const _BusinessAdPreview({required this.id});
  @override
  State<_BusinessAdPreview> createState() => _BusinessAdPreviewState();
}

class _BusinessAdPreviewState extends State<_BusinessAdPreview> {
  late final VideoPlayerController _controller;
  String? _error;
  @override
  void initState() {
    super.initState();
    _controller = VideoPlayerController.networkUrl(
      Uri.parse('$apiBase/business/ads/${widget.id}/video'),
      httpHeaders: {'Authorization': 'Bearer ${Api.instance.token}'},
    );
    _controller
        .initialize()
        .then((_) {
          if (mounted) setState(() {});
        })
        .catchError((Object error) {
          if (mounted) setState(() => _error = '$error');
        });
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Private ad preview')),
    body: Center(
      child: _error != null
          ? Text(_error!)
          : !_controller.value.isInitialized
          ? const CircularProgressIndicator()
          : Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                AspectRatio(
                  aspectRatio: _controller.value.aspectRatio,
                  child: VideoPlayer(_controller),
                ),
                IconButton(
                  onPressed: () {
                    setState(() {
                      if (_controller.value.isPlaying) {
                        _controller.pause();
                      } else {
                        _controller.play();
                      }
                    });
                  },
                  icon: Icon(
                    _controller.value.isPlaying
                        ? Icons.pause
                        : Icons.play_arrow,
                  ),
                ),
              ],
            ),
    ),
  );
}
