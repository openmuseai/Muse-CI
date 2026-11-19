// Explicit authorized transport diagnosis. Never log raw socket exceptions:
// WebSocket errors can contain the token-bearing handshake URL.
import 'dart:async';
import 'dart:convert';
import 'dart:io';
import '../../Muse-Client/packages/openmuse_runtime_config/lib/src/service_dns_io.dart';
import '../../Muse-Client/scripts/ci/local_account_file.dart';

Future<void> main() async {
  HttpClient? client;
  WebSocket? socket;
  var phase = 'configuration';
  try {
    final config =
        jsonDecode(
              await File.fromUri(
                Platform.script.resolve('../.data/cloud.json'),
              ).readAsString(),
            )
            as Map;
    final origin = Uri.parse(config['origin'] as String);
    if (origin.toString() != 'https://cn.openmuseai.com')
      throw StateError('CN origin required');
    final account = parseLocalAccount(await File(config['credentialFile'] as String).readAsString());
    installServiceDnsFallback(
      origins: {origin},
      resolver: Uri.parse('https://dns.alidns.com/resolve'),
    );
    client = HttpClient()..connectionTimeout = const Duration(seconds: 15);
    phase = 'password';
    final request = await client.postUrl(
      origin.resolve('/gotrue/token?grant_type=password'),
    );
    request.headers.contentType = ContentType.json;
    request.write(
      jsonEncode({'email': account.email, 'password': account.password}),
    );
    final response = await request.close().timeout(const Duration(seconds: 20));
    final body = await utf8.decoder.bind(response).join();
    if (response.statusCode != 200) {
      print(jsonEncode({'phase': phase, 'status': response.statusCode}));
      exitCode = 1;
      return;
    }
    final token = (jsonDecode(body) as Map)['access_token'] as String;
    print(
      jsonEncode({'phase': phase, 'status': response.statusCode, 'tls': true}),
    );
    phase = 'websocket';
    final uri = origin.replace(
      scheme: 'wss',
      path: '/ws/v2/${config['workspaceId']}',
      queryParameters: {
        'token': token,
        'deviceId': 'ci-native-transport-probe',
        'clientId': '131971967923784',
      },
    );
    socket = await WebSocket.connect(
      uri.toString(),
      customClient: client,
    ).timeout(const Duration(seconds: 20));
    print(
      jsonEncode({
        'phase': phase,
        'connected': socket.readyState == WebSocket.open,
        'tls': true,
      }),
    );
  } on Object catch (e) {
    print(
      jsonEncode({
        'phase': phase,
        'connected': false,
        'failure': e is TimeoutException ? 'TIMEOUT' : e.runtimeType.toString(),
        'status': e is WebSocketException ? e.httpStatusCode : null,
      }),
    );
    exitCode = 1;
  } finally {
    try {
      await socket?.close().timeout(const Duration(seconds: 2));
    } on Object {}
    client?.close(force: true);
  }
}
