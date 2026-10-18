import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api.dart';

class UploadScreen extends StatefulWidget {
  const UploadScreen({super.key});
  @override
  State<UploadScreen> createState() => _UploadScreenState();
}

class _UploadScreenState extends State<UploadScreen> {
  final _title = TextEditingController();
  final _description = TextEditingController();
  List<Map<String, dynamic>> _categories = [];
  String _categoryId = 'cat-learning';
  PlatformFile? _file;
  double _progress = 0;
  bool _busy = false;
  String? _error;

  static const _types = {
    'mp4': 'video/mp4', 'mov': 'video/quicktime', 'webm': 'video/webm', 'mkv': 'video/x-matroska',
    'avi': 'video/x-msvideo', 'wmv': 'video/x-ms-wmv', 'mpeg': 'video/mpeg', 'mpg': 'video/mpeg',
    '3gp': 'video/3gpp', 'm4v': 'video/x-m4v',
  };

  @override
  void initState() {
    super.initState();
    Api.instance.get('/categories').then((data) {
      if (!mounted) return;
      setState(() {
        _categories = (data as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
        if (_categories.isNotEmpty && !_categories.any((c) => c['id'] == _categoryId)) _categoryId = '${_categories.first['id']}';
      });
    }).catchError((_) {});
  }

  Future<void> _pick() async {
    final picked = await FilePicker.pickFile(type: FileType.video);
    if (picked != null) setState(() => _file = picked);
  }

  Future<void> _submit() async {
    final file = _file;
    if (_title.text.trim().isEmpty || file?.path == null) {
      setState(() => _error = 'Enter a title and choose a video.');
      return;
    }
    final contentType = _types[file!.path!.split('.').last.toLowerCase()];
    if (contentType == null) {
      setState(() => _error = 'Choose an MP4, MOV, WebM, MKV, AVI, WMV, MPEG or 3GP video.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _progress = 0;
    });
    try {
      await Api.instance.uploadFile('POST', '/creator/videos/upload', File(file.path!), contentType, headers: {
        'X-Video-Title': _title.text.trim(),
        'X-Video-Description': _description.text.trim(),
        'X-Video-Category': _categoryId,
        'X-Video-Published': 'true',
        'X-Video-Featured': 'false',
        'X-Video-Promotion-Type': 'product',
      }, onProgress: (p) => setState(() => _progress = p));
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() => _error = '$e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Upload video')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        TextField(controller: _title, maxLength: 120, decoration: const InputDecoration(labelText: 'Title')),
        TextField(controller: _description, maxLines: 3, decoration: const InputDecoration(labelText: 'Description')),
        const SizedBox(height: 12),
        if (_categories.isNotEmpty)
          DropdownButtonFormField<String>(
            initialValue: _categoryId,
            decoration: const InputDecoration(labelText: 'Category'),
            items: [for (final c in _categories) DropdownMenuItem(value: '${c['id']}', child: Text('${c['name']}'))],
            onChanged: (v) => setState(() => _categoryId = v ?? _categoryId),
          ),
        const SizedBox(height: 16),
        OutlinedButton.icon(onPressed: _busy ? null : _pick, icon: const Icon(Icons.video_file), label: Text(_file?.name ?? 'Choose video')),
        if (_busy) Padding(padding: const EdgeInsets.only(top: 16), child: LinearProgressIndicator(value: _progress)),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.redAccent))),
        const SizedBox(height: 20),
        FilledButton(onPressed: _busy ? null : _submit, child: Text(_busy ? 'Uploading ${(_progress * 100).round()}%' : 'Upload')),
      ]),
    );
  }
}
