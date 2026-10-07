import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import {Device} from 'react-native-ble-plx';
import {
  rssiToDistance,
  signalLabel,
  signalColor,
  formatDistance,
  isBystanderNearby,
  RSSI_THRESHOLD,
} from '../utils/bleUtils';

interface Props {
  device: Device;
}

export default function DeviceCard({device}: Props) {
  const rssi = device.rssi ?? -100;
  const distance = rssiToDistance(rssi);
  const nearby = isBystanderNearby(rssi);
  const color = signalColor(rssi);

  return (
    <View style={[styles.card, nearby && styles.cardActive]}>
      <View style={styles.row}>
        <View style={styles.iconWrapper}>
          <View style={[styles.dot, {backgroundColor: color}]} />
        </View>

        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={1}>
            {device.name ?? 'Unknown Device'}
          </Text>
          <Text style={styles.id} numberOfLines={1}>
            {device.id}
          </Text>
        </View>

        <View style={styles.rssiWrapper}>
          <Text style={[styles.rssi, {color}]}>{rssi} dBm</Text>
          <Text style={[styles.label, {color}]}>{signalLabel(rssi)}</Text>
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.distance}>~{formatDistance(distance)}</Text>
        {nearby ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>BYSTANDER RANGE</Text>
          </View>
        ) : (
          <Text style={styles.outRange}>
            &gt;{Math.abs(RSSI_THRESHOLD)} dBm threshold
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#13131a',
    borderWidth: 1,
    borderColor: '#1e1e2e',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
  },
  cardActive: {borderColor: '#30d158'},
  row: {flexDirection: 'row', alignItems: 'center'},
  iconWrapper: {marginRight: 12, alignItems: 'center', justifyContent: 'center'},
  dot: {width: 10, height: 10, borderRadius: 5},
  info: {flex: 1, marginRight: 8},
  name: {color: '#e8e8f0', fontSize: 14, fontWeight: '600', marginBottom: 2},
  id: {color: '#6b6b8a', fontSize: 11, fontFamily: 'monospace'},
  rssiWrapper: {alignItems: 'flex-end'},
  rssi: {fontSize: 15, fontWeight: '700', fontFamily: 'monospace'},
  label: {fontSize: 10, marginTop: 2},
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e1e2e',
  },
  distance: {color: '#6b6b8a', fontSize: 12, fontFamily: 'monospace'},
  badge: {
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    borderWidth: 1,
    borderColor: '#30d158',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {color: '#30d158', fontSize: 9, fontWeight: '700', letterSpacing: 0.5},
  outRange: {color: '#3d3d5c', fontSize: 11},
});
