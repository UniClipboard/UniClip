/**
 * History API Service
 * 历史记录同步 API 服务
 */

import { nativeDownloadFile, nativeUploadMultipart, ProgressInfo } from 'native-util';
import { APIClient, APIClientConfig } from './APIClient';
import { ClipboardContentType, ProfileDto } from '../types/api';
import { ClipboardItem, HistorySyncStatus } from '../types/clipboard';
import { ValidationError } from './errors';

/**
 * 历史记录 DTO（服务器格式）
 */
export interface HistoryRecordDto {
  hash: string;
  type: 'Text' | 'Image' | 'File';
  text?: string;
  createTime?: string;
  lastModified?: string;
  lastAccessed?: string;
  starred?: boolean;
  pinned?: boolean;
  size?: number;
  hasData?: boolean;
  version?: number;
  isDeleted?: boolean;
}

/**
 * 历史记录更新 DTO
 */
export interface HistoryRecordUpdateDto {
  starred?: boolean;
  pinned?: boolean;
  isDelete?: boolean;
  version?: number;
  lastModified?: string;
  lastAccessed?: string;
}

/**
 * 历史记录查询参数
 */
export interface HistoryQueryParams {
  page?: number;
  before?: string;
  after?: string;
  modifiedAfter?: string;
  types?: number;
  searchText?: string;
  starred?: boolean;
  sortByLastAccessed?: boolean;
}

/**
 * 历史记录统计 DTO
 */
export interface HistoryStatisticsDto {
  totalCount: number;
  starredCount: number;
  deletedCount: number;
  activeCount: number;
  totalFileSizeMB: number;
}

/**
 * 同步冲突错误
 */
export class SyncConflictError extends Error {
  public readonly serverRecord: HistoryRecordDto;

  constructor(message: string, serverRecord: HistoryRecordDto) {
    super(message);
    this.name = 'SyncConflictError';
    this.serverRecord = serverRecord;
  }
}

/**
 * 记录不存在错误
 */
export class RecordNotFoundError extends Error {
  public readonly profileId: string;

  constructor(profileId: string) {
    super(`Record not found: ${profileId}`);
    this.name = 'RecordNotFoundError';
    this.profileId = profileId;
  }
}

/**
 * 类型过滤位掩码
 */
export const ProfileTypeFilter = {
  Text: 1,
  Image: 2,
  File: 4,
  Group: 8,
  All: 15,
  FileAndGroup: 12,
} as const;

/**
 * History API 接口
 */
export interface IHistoryAPI {
  queryRecords(params: HistoryQueryParams, signal?: AbortSignal): Promise<HistoryRecordDto[]>;
  getRecord(profileId: string, signal?: AbortSignal): Promise<HistoryRecordDto>;
  updateRecord(
    type: 'Text' | 'Image' | 'File',
    profileId: string,
    update: HistoryRecordUpdateDto,
    signal?: AbortSignal
  ): Promise<HistoryRecordDto>;
  downloadData(
    profileId: string,
    destinationUri: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<string>;
  uploadRecord(
    record: HistoryRecordDto,
    fileUri?: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<HistoryRecordDto>;
  getStatistics(signal?: AbortSignal): Promise<HistoryStatisticsDto>;
  getServerTime(): Promise<Date>;
}

/**
 * History API 客户端
 */
export class HistoryAPI extends APIClient implements IHistoryAPI {
  private static readonly API_PREFIX = '/api/history';

  constructor(config: APIClientConfig) {
    super(config);
  }

  /**
   * 查询历史记录
   */
  async queryRecords(
    params: HistoryQueryParams,
    signal?: AbortSignal
  ): Promise<HistoryRecordDto[]> {
    const formData = new FormData();

    if (params.page !== undefined) {
      formData.append('page', params.page.toString());
    }
    if (params.before) {
      formData.append('before', params.before);
    }
    if (params.after) {
      formData.append('after', params.after);
    }
    if (params.modifiedAfter) {
      formData.append('modifiedAfter', params.modifiedAfter);
    }
    if (params.types !== undefined) {
      formData.append('types', params.types.toString());
    }
    if (params.searchText) {
      formData.append('searchText', params.searchText);
    }
    if (params.starred !== undefined) {
      formData.append('starred', params.starred.toString());
    }
    if (params.sortByLastAccessed !== undefined) {
      formData.append('sortByLastAccessed', params.sortByLastAccessed.toString());
    }

    console.log(
      '[HistoryAPI] queryRecords params:',
      Object.fromEntries(formData as unknown as Iterable<[string, string]>)
    );

    try {
      const response = await this.client.post<HistoryRecordDto[]>(
        `${HistoryAPI.API_PREFIX}/query`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          signal,
        }
      );
      console.log('[HistoryAPI] queryRecords response length:', response.data?.length || 0);
      return response.data || [];
    } catch (error) {
      console.error('[HistoryAPI] Failed to query records:', error);
      throw error;
    }
  }

  /**
   * 获取单条记录
   */
  async getRecord(profileId: string, signal?: AbortSignal): Promise<HistoryRecordDto> {
    if (!profileId) {
      throw new ValidationError('Profile ID is required');
    }

    try {
      const record = await this.get<HistoryRecordDto>(
        `${HistoryAPI.API_PREFIX}/${encodeURIComponent(profileId)}`,
        signal ? { signal } : undefined
      );
      return record;
    } catch (error) {
      if (error && typeof error === 'object' && 'response' in error) {
        const errorObj = error as Record<string, unknown>;
        if (errorObj.response && typeof errorObj.response === 'object') {
          const response = errorObj.response as Record<string, unknown>;
          if (response.status === 404) {
            throw new RecordNotFoundError(profileId);
          }
        }
      }
      console.error('[HistoryAPI] Failed to get record:', error);
      throw error;
    }
  }

  /**
   * 更新记录
   */
  async updateRecord(
    type: 'Text' | 'Image' | 'File',
    profileId: string,
    update: HistoryRecordUpdateDto,
    signal?: AbortSignal
  ): Promise<HistoryRecordDto> {
    if (!profileId) {
      throw new ValidationError('Profile ID is required');
    }

    try {
      const record = await this.patch<HistoryRecordDto>(
        `${HistoryAPI.API_PREFIX}/${type}/${encodeURIComponent(profileId)}`,
        update,
        signal ? { signal } : undefined
      );
      return record;
    } catch (error) {
      // 处理 APIError（包括 409 冲突和 404 未找到）
      if (error && typeof error === 'object') {
        const apiError = error as { name?: string; statusCode?: number; response?: unknown };

        // 409 冲突
        if (apiError.statusCode === 409 && apiError.response) {
          const serverRecord = apiError.response as HistoryRecordDto;
          throw new SyncConflictError('Version conflict', serverRecord);
        }

        // 404 未找到
        if (apiError.statusCode === 404) {
          throw new RecordNotFoundError(profileId);
        }
      }
      console.error('[HistoryAPI] Failed to update record:', error);
      throw error;
    }
  }

  /**
   * 下载数据文件
   */
  async downloadData(
    profileId: string,
    destinationUri: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<string> {
    if (!profileId) {
      throw new ValidationError('Profile ID is required');
    }
    if (!destinationUri) {
      throw new ValidationError('Destination URI is required');
    }

    const url = `${this.baseURL}${HistoryAPI.API_PREFIX}/${encodeURIComponent(profileId)}/data`;

    try {
      const headers = await this.getHeaders();

      console.log(`[HistoryAPI] ========== Download Request ==========`);
      console.log(`[HistoryAPI] API: downloadData`);
      console.log(`[HistoryAPI] ProfileId: ${profileId}`);
      console.log(`[HistoryAPI] URL: ${url}`);
      console.log(`[HistoryAPI] Destination: ${destinationUri}`);
      console.log(`[HistoryAPI] Headers:`, JSON.stringify(headers, null, 2));
      console.log(`[HistoryAPI] Signal aborted: ${signal?.aborted}`);

      await nativeDownloadFile(url, headers, destinationUri, signal, onProgress);

      console.log(`[HistoryAPI] Data downloaded successfully: ${profileId}`);
      return destinationUri;
    } catch (error) {
      console.error(`[HistoryAPI] ========== Download Failed ==========`);
      console.error(`[HistoryAPI] ProfileId: ${profileId}`);
      console.error(`[HistoryAPI] URL: ${url}`);
      console.error(`[HistoryAPI] Error:`, error);
      throw error;
    }
  }

  async uploadRecord(
    record: HistoryRecordDto,
    fileUri?: string,
    signal?: AbortSignal,
    onProgress?: (info: ProgressInfo) => void
  ): Promise<HistoryRecordDto> {
    if (!record.hash) {
      throw new ValidationError('Record hash is required');
    }
    if (!record.type) {
      throw new ValidationError('Record type is required');
    }

    const url = `${this.baseURL}${HistoryAPI.API_PREFIX}`;
    const headers = await this.getHeaders();

    const formFields: Record<string, string> = {
      hash: record.hash,
      type: record.type,
    };

    if (record.text) {
      formFields.text = record.text;
    }
    if (record.createTime) {
      formFields.createTime = record.createTime;
    }
    if (record.lastModified) {
      formFields.lastModified = record.lastModified;
    }
    if (record.lastAccessed) {
      formFields.lastAccessed = record.lastAccessed;
    }
    if (record.starred !== undefined) {
      formFields.starred = record.starred.toString();
    }
    if (record.pinned !== undefined) {
      formFields.pinned = record.pinned.toString();
    }
    if (record.size !== undefined) {
      formFields.size = record.size.toString();
    }
    if (record.hasData !== undefined) {
      formFields.hasData = record.hasData.toString();
    }
    if (record.isDeleted !== undefined) {
      formFields.isDeleted = record.isDeleted.toString();
    }
    if (record.version !== undefined) {
      formFields.version = record.version.toString();
    }

    console.log(`[HistoryAPI] ========== Upload Request ==========`);
    console.log(`[HistoryAPI] API: uploadData`);
    console.log(`[HistoryAPI] URL: ${url}`);
    console.log(`[HistoryAPI] Form fields:`, formFields);
    console.log(`[HistoryAPI] File: ${fileUri || 'none'}`);

    try {
      await nativeUploadMultipart(url, headers, formFields, fileUri, signal, onProgress);
      console.log(`[HistoryAPI] Upload completed successfully`);
      return this.getRecord(`${record.type}-${record.hash}`, signal);
    } catch (error) {
      console.error(`[HistoryAPI] ========== Upload Failed ==========`);
      console.error(`[HistoryAPI] URL: ${url}`);
      console.error(`[HistoryAPI] Error:`, error);
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  async getStatistics(signal?: AbortSignal): Promise<HistoryStatisticsDto> {
    try {
      const stats = await this.get<HistoryStatisticsDto>(
        `${HistoryAPI.API_PREFIX}/statistics`,
        signal ? { signal } : undefined
      );
      return stats;
    } catch (error) {
      console.error('[HistoryAPI] Failed to get statistics:', error);
      throw error;
    }
  }

  /**
   * 获取服务器时间
   */
  async getServerTime(): Promise<Date> {
    try {
      const response = await this.client.head('/');
      const dateHeader = response.headers['date'];

      if (dateHeader) {
        return new Date(dateHeader);
      }

      return new Date();
    } catch (error) {
      console.error('[HistoryAPI] Failed to get server time:', error);
      return new Date();
    }
  }

  /**
   * 上传文件数据（历史记录不支持直接上传文件）
   */
  async putFile(_fileName: string, _fileUri: string, _signal?: AbortSignal): Promise<void> {
    throw new Error('HistoryAPI does not support direct file upload. Use uploadData instead.');
  }

  /**
   * 上传剪贴板配置（历史记录不支持）
   */
  async putClipboard(_profile: ProfileDto, _signal?: AbortSignal): Promise<void> {
    throw new Error('HistoryAPI does not support putClipboard operation.');
  }
}

/**
 * 工具函数：将 HistoryRecordDto 转换为 ClipboardItem
 */
export function dtoToClipboardItem(dto: HistoryRecordDto): ClipboardItem {
  return {
    type: dto.type as ClipboardContentType,
    text: dto.text || '',
    profileHash: dto.hash,
    hasData: dto.hasData || false,
    size: dto.size ?? 0,
    timestamp: dto.createTime ? new Date(dto.createTime).getTime() : Date.now(),
    starred: dto.starred ?? false,
    pinned: dto.pinned ?? false,
    syncStatus: HistorySyncStatus.Synced,
    version: dto.version ?? 0,
    lastModified: dto.lastModified ? new Date(dto.lastModified).getTime() : Date.now(),
    lastAccessed: dto.lastAccessed ? new Date(dto.lastAccessed).getTime() : Date.now(),
    isDeleted: dto.isDeleted ?? false,
    hasRemoteData: dto.hasData ?? false,
    isLocalFileReady: false,
  };
}

/**
 * 工具函数：将 ClipboardItem 转换为 HistoryRecordDto
 */
export function clipboardItemToDto(item: ClipboardItem): HistoryRecordDto {
  const hash = item.profileHash.includes('-')
    ? item.profileHash.split('-').slice(1).join('-')
    : item.profileHash;

  return {
    hash,
    type: item.type as 'Text' | 'Image' | 'File',
    text: item.text,
    createTime: item.timestamp ? new Date(item.timestamp).toISOString() : undefined,
    lastModified: item.lastModified ? new Date(item.lastModified).toISOString() : undefined,
    lastAccessed: item.lastAccessed ? new Date(item.lastAccessed).toISOString() : undefined,
    starred: item.starred,
    pinned: item.pinned,
    size: item.size,
    hasData: item.hasData,
    version: item.version,
    isDeleted: item.isDeleted,
  };
}

/**
 * 工具函数：生成 profileId
 */
export function getProfileId(type: string, hash: string): string {
  return `${type}-${hash}`;
}

/**
 * 工具函数：从 profileId 解析 type 和 hash
 */
export function parseProfileId(
  profileId: string
): { type: 'Text' | 'Image' | 'File'; hash: string } | null {
  const parts = profileId.split('-');
  if (parts.length < 2) {
    return null;
  }
  const type = parts[0] as 'Text' | 'Image' | 'File';
  const hash = parts.slice(1).join('-');
  if (!['Text', 'Image', 'File'].includes(type)) {
    return null;
  }
  return { type, hash };
}
