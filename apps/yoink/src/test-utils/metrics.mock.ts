import { YoinkMetricsService } from 'src/yoink-metrics.service'

export function makeMetricsMock(): jest.Mocked<YoinkMetricsService> {
  return {
    downloadInitiated: jest.fn(),
    downloadCompleted: jest.fn(),
    setActiveDownloads: jest.fn(),
    setPendingCancels: jest.fn(),
    libraryOperation: jest.fn(),
    search: jest.fn(),
    externalApiError: jest.fn(),
    startPollTimer: jest.fn().mockReturnValue(jest.fn()),
    pollError: jest.fn(),
    authLogin: jest.fn(),
    setWebsocketConnections: jest.fn(),
  } as unknown as jest.Mocked<YoinkMetricsService>
}
