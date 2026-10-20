const playbackSpeeds = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];

bool isDirectPlayback(String source) => RegExp(
  r'\.(mp4|webm|ogv|ogg|m3u8)(?:$|[?#])',
  caseSensitive: false,
).hasMatch(source);

String normalPlaybackUrl(String source) {
  if (!RegExp(
    r'^https://(?:iframe|player)\.mediadelivery\.net/embed/',
    caseSensitive: false,
  ).hasMatch(source)) {
    return source;
  }
  final url = Uri.parse(source);
  return url
      .replace(
        queryParameters: {
          ...url.queryParameters,
          'preload': 'true',
          'showSpeed': 'true',
          'levelCap': 'true',
        },
      )
      .toString();
}
