import 'package:flutter_test/flutter_test.dart';
import 'package:zinda_play/ads.dart';

void main() {
  test('video ads honor independent 1, 5, and 10 video intervals', () {
    final ads = <Map<String, dynamic>>[
      {'id': 'every-one', 'frequency': 1},
      {'id': 'every-five', 'frequency': 5},
      {'id': 'every-ten', 'frequency': 10},
    ];
    for (var opening = 1; opening <= 20; opening++) {
      final due = AdsApi.dueVideos(ads);
      expect(due.map((ad) => ad['id']).toList(), [
        'every-one',
        if (opening % 5 == 0) 'every-five',
        if (opening % 10 == 0) 'every-ten',
      ]);
      for (final ad in due) {
        AdsApi.markDelivered(ad['id'] as String);
      }
    }
  });

  test('a due ad remains due until it is delivered', () {
    final ads = <Map<String, dynamic>>[
      {'id': 'waiting-for-delivery', 'frequency': 5},
    ];
    for (var opening = 1; opening < 5; opening++) {
      expect(AdsApi.dueVideos(ads), isEmpty);
    }
    expect(AdsApi.dueVideos(ads), hasLength(1));
    expect(AdsApi.dueVideos(ads), hasLength(1));
    AdsApi.markDelivered('waiting-for-delivery');
    expect(AdsApi.dueVideos(ads), isEmpty);
  });
}
