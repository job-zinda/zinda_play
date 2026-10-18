import 'api.dart';

class ShortsPage {
  final List<Map<String, dynamic>> items;
  final String? nextCursor;
  ShortsPage(this.items, this.nextCursor);

  factory ShortsPage.fromJson(dynamic value) {
    final map = Map<String, dynamic>.from(value as Map);
    return ShortsPage(
      (map['items'] as List)
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList(),
      map['nextCursor'] as String?,
    );
  }
}

class ShortsApi {
  final Api api;
  ShortsApi({Api? api}) : api = api ?? Api.instance;

  Future<ShortsPage> page({String? cursor, bool saved = false}) async {
    final query = cursor == null
        ? ''
        : '?${saved ? 'before' : 'cursor'}=${Uri.encodeQueryComponent(cursor)}';
    return ShortsPage.fromJson(
      await api.get('/shorts${saved ? '/saved' : ''}$query'),
    );
  }
}

String? validateShortVideo(Duration duration, double width, double height) {
  if (duration.inMilliseconds <= 0 || duration.inMilliseconds > 60000) {
    return 'Choose a video no longer than 60 seconds.';
  }
  if (!width.isFinite ||
      !height.isFinite ||
      width <= 0 ||
      height <= width ||
      (width / height - 9 / 16).abs() > 0.04) {
    return 'Choose a 9:16 portrait video (for example, 1080 x 1920).';
  }
  return null;
}

List<String> shortHashtags(String text) => text
    .split(RegExp(r'[\s,]+'))
    .map((tag) => tag.replaceFirst(RegExp(r'^#'), ''))
    .where((tag) => tag.isNotEmpty)
    .toSet()
    .toList();
