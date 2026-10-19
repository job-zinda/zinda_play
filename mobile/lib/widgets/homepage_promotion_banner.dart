import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api.dart';

class HomepagePromotionBanner extends StatelessWidget {
  final Map<String, dynamic> banner;
  final bool framed;
  const HomepagePromotionBanner({
    super.key,
    required this.banner,
    this.framed = true,
  });

  Future<void> _open(BuildContext context) async {
    try {
      final uri = Uri.parse('${banner['buttonUrl']}');
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        throw ApiException('Could not open the banner link.');
      }
    } catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$error')));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final image = '${banner['imageUrl'] ?? ''}'.trim();
    if (banner['enabled'] != true || image.isEmpty) {
      return const SizedBox.shrink();
    }
    final url = Uri.tryParse('${banner['buttonUrl'] ?? ''}');
    final content = InkWell(
      onTap: url != null && ['http', 'https'].contains(url.scheme)
          ? () => _open(context)
          : null,
      child: Image.network(
        assetUrl(image),
        fit: BoxFit.contain,
        semanticLabel: '${banner['title'] ?? 'Zinda Play banner'}',
        errorBuilder: (_, _, _) =>
            const Center(child: Text('Banner image unavailable')),
      ),
    );
    if (!framed) return content;
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: AspectRatio(aspectRatio: 3, child: content),
      ),
    );
  }
}

/// Rotates through every enabled homepage banner every few seconds.
class HomepagePromotionCarousel extends StatefulWidget {
  final List<Map<String, dynamic>> banners;
  const HomepagePromotionCarousel({super.key, required this.banners});

  @override
  State<HomepagePromotionCarousel> createState() =>
      _HomepagePromotionCarouselState();
}

class _HomepagePromotionCarouselState extends State<HomepagePromotionCarousel> {
  final _controller = PageController();
  Timer? _timer;
  int _index = 0;

  List<Map<String, dynamic>> get _visible => widget.banners
      .where(
        (b) =>
            b['enabled'] == true && '${b['imageUrl'] ?? ''}'.trim().isNotEmpty,
      )
      .toList();

  @override
  void initState() {
    super.initState();
    _restart();
  }

  @override
  void didUpdateWidget(HomepagePromotionCarousel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (_index >= _visible.length) _index = 0;
    _restart();
  }

  void _restart() {
    _timer?.cancel();
    if (_visible.length < 2) return;
    _timer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || !_controller.hasClients) return;
      final next = (_index + 1) % _visible.length;
      _controller.animateToPage(
        next,
        duration: const Duration(milliseconds: 450),
        curve: Curves.easeOut,
      );
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final banners = _visible;
    if (banners.isEmpty) return const SizedBox.shrink();
    if (banners.length == 1) return HomepagePromotionBanner(banner: banners.first);
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 0),
      child: Column(
        children: [
          AspectRatio(
            aspectRatio: 3,
            child: Card(
              margin: EdgeInsets.zero,
              clipBehavior: Clip.antiAlias,
              child: PageView.builder(
                controller: _controller,
                itemCount: banners.length,
                onPageChanged: (i) {
                  setState(() => _index = i);
                  _restart();
                },
                itemBuilder: (_, i) => HomepagePromotionBanner(
                  banner: banners[i],
                  framed: false,
                ),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              for (var i = 0; i < banners.length; i++)
                AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: i == _index ? 18 : 6,
                  height: 6,
                  decoration: BoxDecoration(
                    color: i == _index ? Colors.white : Colors.white38,
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
