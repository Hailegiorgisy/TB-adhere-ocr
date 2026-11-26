import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import NetInfo from '@react-native-community/netinfo';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import {
  ExtractedTBRecord,
  parseTBRegisterRow,
} from './src/utils/tbRegisterParser';
import {
  enqueueVerifiedEnrollment,
  flushOutboxToServer,
  getQueueCounts,
  purgeTemporaryPhoto,
} from './src/services/offlineSyncQueue';

const FACILITY_CODE = 'AA-KK-W08'; // Kolfe Keranio Woreda 08 Health Center

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);

  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [queueCounts, setQueueCounts] = useState({ pending: 0, synced: 0 });
  const [tempPhotoUri, setTempPhotoUri] = useState<string | null>(null);
  const [record, setRecord] = useState<ExtractedTBRecord | null>(null);
  const [editedByUser, setEditedByUser] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);

  const refreshQueueStatus = async () => {
    const counts = await getQueueCounts();
    setQueueCounts(counts);
  };

  useEffect(() => {
    refreshQueueStatus();
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const online = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsOnline(online);
      if (online) {
        await flushOutboxToServer();
        await refreshQueueStatus();
      }
    });
    return () => unsubscribe();
  }, []);

  const handleCaptureRegisterRow = async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.85,
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error('Camera capture returned empty URI');

      setTempPhotoUri(photo.uri);
      const ocrResult = await TextRecognition.recognize(photo.uri);
      const parsed = parseTBRegisterRow(ocrResult.text || '', FACILITY_CODE);
      setRecord(parsed);
      setEditedByUser(false);
    } catch (err: any) {
      Alert.alert('Capture / OCR Error', err?.message || 'Unable to process register row.');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadSampleDemoRow = () => {
    const sampleRaw = '042/26 | 34 M | Ketena 03 | PTB+ | HIV- | 0911234567 | 0912987654';
    const parsed = parseTBRegisterRow(sampleRaw, FACILITY_CODE, [0.98, 0.96, 0.99]);
    setTempPhotoUri(null);
    setRecord(parsed);
    setEditedByUser(false);
  };

  const handleVerifyAndSave = async () => {
    if (!record) return;
    if (!record.tbRegisterNo || !record.patientPhone) {
      Alert.alert('Missing Required Fields', 'Please confirm TB Register # and Patient Phone.');
      return;
    }
    setBusy(true);
    try {
      const res = await enqueueVerifiedEnrollment(record, tempPhotoUri, editedByUser);
      setTempPhotoUri(null);
      setRecord(null);
      await refreshQueueStatus();

      Alert.alert(
        res.syncedImmediately ? 'Saved & Synced to Server' : 'Saved Offline (Queued for Sync)',
        `Raw register photo permanently purged.\nRisk Tier: ${record.riskTier} (${(
          record.ltfuRiskScore * 100
        ).toFixed(1)}% LTFU risk).\nPending Offline Queue: ${res.queueCount}`
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    await purgeTemporaryPhoto(tempPhotoUri);
    setTempPhotoUri(null);
    setRecord(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Top Status Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>SMARTCARE ADHERE-ET • OCR</Text>
          <Text style={styles.facility}>Facility: {FACILITY_CODE}</Text>
        </View>
        <View style={[styles.badge, isOnline ? styles.badgeOnline : styles.badgeOffline]}>
          <Text style={styles.badgeText}>{isOnline ? 'ONLINE • AUTO-SYNC' : 'OFFLINE • SQLITE QUEUE'}</Text>
        </View>
      </View>

      {/* Sync Queue Banner */}
      <View style={styles.syncBar}>
        <Text style={styles.syncText}>
          Pending Upload: <Text style={styles.bold}>{queueCounts.pending}</Text>  |  Synced to DB:{' '}
          <Text style={styles.bold}>{queueCounts.synced}</Text>
        </Text>
        <TouchableOpacity
          style={styles.syncBtn}
          onPress={async () => {
            await flushOutboxToServer();
            await refreshQueueStatus();
          }}
        >
          <Text style={styles.syncBtnText}>Sync Now</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {!record ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>1. Frame Single TB Register Row</Text>
            <Text style={styles.hint}>
              Align one horizontal patient row inside the teal guide. Raw photos are automatically deleted immediately after verification.
            </Text>

            {!permission?.granted ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
                <Text style={styles.primaryBtnText}>Grant Camera Permission</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.cameraBox}>
                <CameraView ref={cameraRef} style={styles.camera} facing="back">
                  <View style={styles.roiFrame}>
                    <Text style={styles.roiLabel}>ALIGN SINGLE REGISTER ROW HERE</Text>
                  </View>
                </CameraView>
              </View>
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleCaptureRegisterRow} disabled={busy}>
              <Text style={styles.primaryBtnText}>
                {busy ? 'Running On-Device OCR...' : 'Capture & Extract Row (Offline)'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.secondaryBtn} onPress={handleLoadSampleDemoRow}>
              <Text style={styles.secondaryBtnText}>Load Sample TB Register Row (Demo)</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.sectionTitle}>2. Verify Extracted Fields (15s)</Text>
              <View
                style={[
                  styles.riskPill,
                  record.riskTier === 'HIGH' ? styles.riskHigh : styles.riskStd,
                ]}
              >
                <Text style={styles.riskPillText}>
                  {record.riskTier} RISK ({(record.ltfuRiskScore * 100).toFixed(0)}%)
                </Text>
              </View>
            </View>

            <Text style={styles.privacyNote}>
              Zero-Image Policy: Raw photo will be purged from memory immediately on Save.
            </Text>

            <FieldInput
              label="TB Unit Register #"
              value={record.tbRegisterNo}
              warn={record.lowConfidenceFields.includes('tbRegisterNo')}
              onChange={(v) => {
                setEditedByUser(true);
                setRecord({ ...record, tbRegisterNo: v });
              }}
            />
            <View style={styles.rowGap}>
              <View style={{ flex: 1 }}>
                <FieldInput
                  label="Age"
                  value={record.age !== null ? String(record.age) : ''}
                  warn={record.lowConfidenceFields.includes('age')}
                  onChange={(v) => {
                    setEditedByUser(true);
                    setRecord({ ...record, age: parseInt(v, 10) || null });
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <FieldInput
                  label="Sex (M/F)"
                  value={record.sex}
                  warn={record.lowConfidenceFields.includes('sex')}
                  onChange={(v) => {
                    setEditedByUser(true);
                    setRecord({ ...record, sex: (v.toUpperCase() as 'M' | 'F') || '' });
                  }}
                />
              </View>
            </View>

            <View style={styles.rowGap}>
              <View style={{ flex: 1 }}>
                <FieldInput
                  label="TB Type"
                  value={record.tbType}
                  warn={record.lowConfidenceFields.includes('tbType')}
                  onChange={(v) => {
                    setEditedByUser(true);
                    setRecord({ ...record, tbType: v as any });
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <FieldInput
                  label="HIV Status"
                  value={record.hivStatus}
                  warn={record.lowConfidenceFields.includes('hivStatus')}
                  onChange={(v) => {
                    setEditedByUser(true);
                    setRecord({ ...record, hivStatus: v as any });
                  }}
                />
              </View>
            </View>

            <FieldInput
              label="Patient Phone (+251...)"
              value={record.patientPhone}
              warn={record.lowConfidenceFields.includes('patientPhone')}
              onChange={(v) => {
                setEditedByUser(true);
                setRecord({ ...record, patientPhone: v });
              }}
            />
            <FieldInput
              label="Treatment Supporter Phone (+251...)"
              value={record.supporterPhone}
              warn={record.lowConfidenceFields.includes('supporterPhone')}
              onChange={(v) => {
                setEditedByUser(true);
                setRecord({ ...record, supporterPhone: v });
              }}
            />

            <TouchableOpacity style={styles.primaryBtn} onPress={handleVerifyAndSave} disabled={busy}>
              <Text style={styles.primaryBtnText}>Verify, Purge Photo & Queue Sync</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.discardBtn} onPress={handleDiscard}>
              <Text style={styles.discardBtnText}>Discard & Wipe Image</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function FieldInput({
  label,
  value,
  warn,
  onChange,
}: {
  label: string;
  value: string;
  warn?: boolean;
  onChange: (val: string) => void;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>
        {label} {warn ? '⚠️ (Verify)' : '✓'}
      </Text>
      <TextInput
        style={[styles.input, warn && styles.inputWarn]}
        value={value}
        onChangeText={onChange}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F4F8' },
  header: {
    backgroundColor: '#1B365D',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: { color: '#81E6D9', fontWeight: '700', fontSize: 12 },
  facility: { color: '#FFFFFF', fontWeight: '700', fontSize: 15, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  badgeOnline: { backgroundColor: '#007A78' },
  badgeOffline: { backgroundColor: '#B7791F' },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  syncBar: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  syncText: { fontSize: 12, color: '#1A202C' },
  bold: { fontWeight: '700' },
  syncBtn: { backgroundColor: '#1B365D', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6 },
  syncBtnText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  scroll: { padding: 16 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 16, elevation: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1B365D', marginBottom: 4 },
  hint: { fontSize: 12.5, color: '#4A5568', marginBottom: 12 },
  cameraBox: { height: 220, borderRadius: 10, overflow: 'hidden', marginBottom: 12 },
  camera: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  roiFrame: {
    width: '92%',
    height: 74,
    borderWidth: 2,
    borderColor: '#81E6D9',
    borderStyle: 'dashed',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 122, 120, 0.15)',
  },
  roiLabel: { color: '#FFFFFF', fontWeight: '700', fontSize: 11 },
  primaryBtn: {
    backgroundColor: '#007A78',
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#1B365D',
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  secondaryBtnText: { color: '#1B365D', fontWeight: '600', fontSize: 13 },
  discardBtn: { paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  discardBtnText: { color: '#C53030', fontWeight: '600', fontSize: 13 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowGap: { flexDirection: 'row', gap: 10 },
  riskPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  riskHigh: { backgroundColor: '#FED7D7' },
  riskStd: { backgroundColor: '#E6FFFA' },
  riskPillText: { fontSize: 11, fontWeight: '700', color: '#1A202C' },
  privacyNote: { fontSize: 11.5, color: '#007A78', fontWeight: '600', marginVertical: 8 },
  fieldWrap: { marginBottom: 10 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#4A5568', marginBottom: 3 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#1A202C',
  },
  inputWarn: { borderColor: '#D69E2E', backgroundColor: '#FEFCBF' },
});
