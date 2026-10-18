import 'dart:io';
import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../api.dart';
import '../shorts.dart';

class CreateShortScreen extends StatefulWidget {
  const CreateShortScreen({super.key});
  @override
  State<CreateShortScreen> createState() => _CreateShortScreenState();
}

class _CreateShortScreenState extends State<CreateShortScreen> {
  final _caption = TextEditingController();
  final _tags = TextEditingController();
  List<Map<String, dynamic>> _categories = [];
  String? _category;
  File? _file;
  String? _type;
  VideoPlayerController? _preview;
  bool _busy = false;
  bool _picking = false;
  bool _submitted = false;
  double _progress = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await Api.instance.get('/categories') as List;
      if (!mounted) return;
      setState(() {
        _categories = list
            .map((item) => Map<String, dynamic>.from(item as Map))
            .toList();
        _category ??= _categories.isEmpty ? null : '${_categories.first['id']}';
        _error = null;
      });
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    }
  }

  Future<void> _pick() async {
    setState(() {
      _picking = true;
      _error = null;
    });
    VideoPlayerController? candidate;
    try {
      final picked = await FilePicker.pickFile(type: FileType.video);
      if (picked?.path == null) return;
      const types = {
        'mp4': 'video/mp4',
        'mov': 'video/quicktime',
        'webm': 'video/webm',
      };
      final type = types[picked!.path!.split('.').last.toLowerCase()];
      final file = File(picked.path!);
      final size = await file.length();
      if (type == null || size <= 0 || size > 150 * 1024 * 1024) {
        throw ApiException('Choose MP4, MOV or WebM up to 150 MB.');
      }
      candidate = VideoPlayerController.file(file);
      await candidate.initialize().timeout(const Duration(seconds: 20));
      final value = candidate.value;
      final error = validateShortVideo(
        value.duration,
        value.size.width,
        value.size.height,
      );
      if (error != null) throw ApiException(error);
      if (!mounted) return;
      final old = _preview;
      setState(() {
        _file = file;
        _type = type;
        _preview = candidate;
      });
      candidate = null;
      await old?.dispose();
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      await candidate?.dispose();
      if (mounted) setState(() => _picking = false);
    }
  }

  Future<void> _upload() async {
    final preview = _preview;
    if (_file == null ||
        preview == null ||
        _category == null ||
        _caption.text.trim().isEmpty) {
      setState(() => _error = 'Choose a video, caption and category.');
      return;
    }
    final tags = shortHashtags(_tags.text);
    if (tags.length > 10 ||
        tags.any(
          (tag) =>
              !RegExp(r'^[\p{L}\p{N}_]{1,30}$', unicode: true).hasMatch(tag),
        )) {
      setState(
        () => _error =
            'Use up to 10 hashtags, each 1-30 letters, numbers or underscores.',
      );
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _progress = 0;
    });
    try {
      await preview.pause();
      final value = preview.value;
      await Api.instance.uploadFile(
        'POST',
        '/creator/videos/upload',
        _file!,
        _type!,
        headers: {
          'X-Video-Type': 'short',
          'X-Video-Title': 'Simply',
          'X-Short-Caption': Uri.encodeComponent(_caption.text.trim()),
          'X-Short-Hashtags': Uri.encodeComponent(jsonEncode(tags)),
          'X-Video-Category': _category!,
          'X-Video-Duration': '${value.duration.inMilliseconds / 1000}',
          'X-Video-Width': '${value.size.width}',
          'X-Video-Height': '${value.size.height}',
        },
        onProgress: (progress) {
          if (mounted) setState(() => _progress = progress);
        },
      );
      if (!mounted) return;
      setState(() => _submitted = true);
    } catch (error) {
      if (mounted) setState(() => _error = '$error');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _preview?.dispose();
    _caption.dispose();
    _tags.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => PopScope(
    canPop: !_busy && !_picking,
    child: Scaffold(
      appBar: AppBar(title: const Text('Create Simply')),
      body: _submitted
          ? Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.check_circle,
                      color: Colors.deepPurpleAccent,
                      size: 56,
                    ),
                    const Text(
                      'Simply video uploaded. Encoding and admin approval are required before it appears. Check Creator studio for status.',
                    ),
                    FilledButton(
                      onPressed: () => Navigator.pop(context, true),
                      child: const Text('Done'),
                    ),
                  ],
                ),
              ),
            )
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  '9:16 portrait • Up to 60 seconds • MP4, MOV or WebM • Maximum 150 MB\nExisting creator approval, profile photo and membership rules apply.',
                ),
                if (_preview != null)
                  Center(
                    child: SizedBox(
                      width: 180,
                      child: AspectRatio(
                        aspectRatio: 9 / 16,
                        child: VideoPlayer(_preview!),
                      ),
                    ),
                  ),
                OutlinedButton.icon(
                  onPressed: _busy || _picking ? null : _pick,
                  icon: const Icon(Icons.video_file),
                  label: Text(
                    _picking ? 'Checking video...' : 'Choose portrait video',
                  ),
                ),
                TextField(
                  controller: _caption,
                  enabled: !_busy,
                  maxLength: 2000,
                  maxLines: 3,
                  decoration: const InputDecoration(labelText: 'Caption'),
                ),
                TextField(
                  controller: _tags,
                  enabled: !_busy,
                  maxLength: 320,
                  decoration: const InputDecoration(
                    labelText: 'Hashtags (up to 10)',
                    hintText: '#zinda #learning',
                  ),
                ),
                if (_categories.isNotEmpty)
                  DropdownButtonFormField<String>(
                    initialValue: _category,
                    decoration: const InputDecoration(labelText: 'Category'),
                    items: _categories
                        .map(
                          (category) => DropdownMenuItem(
                            value: '${category['id']}',
                            child: Text('${category['name']}'),
                          ),
                        )
                        .toList(),
                    onChanged: _busy
                        ? null
                        : (value) => setState(() => _category = value),
                  ),
                if (_categories.isEmpty)
                  TextButton(
                    onPressed: _load,
                    child: const Text('Retry categories'),
                  ),
                if (_busy) ...[
                  LinearProgressIndicator(value: _progress),
                  Text(
                    _progress >= 1
                        ? 'Finishing upload on server...'
                        : 'Uploading ${(_progress * 100).round()}%',
                  ),
                ],
                if (_error != null)
                  Text(
                    _error!,
                    style: const TextStyle(color: Colors.redAccent),
                  ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _busy || _picking ? null : _upload,
                  child: const Text('Upload for approval'),
                ),
              ],
            ),
    ),
  );
}
