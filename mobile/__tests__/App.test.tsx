import 'react-native';
import React from 'react';
import {expect, it, jest} from '@jest/globals';
import renderer, {act} from 'react-test-renderer';

jest.mock('react-native-ble-plx', () => ({
  BleManager: jest.fn().mockImplementation(() => ({
    onStateChange: jest.fn(() => ({remove: jest.fn()})),
    startDeviceScan: jest.fn(),
    stopDeviceScan: jest.fn(),
    destroy: jest.fn(),
  })),
  State: {Unknown: 'Unknown', PoweredOn: 'PoweredOn'},
}));
jest.mock('react-native-permissions', () => ({
  check: jest.fn(),
  request: jest.fn(),
  PERMISSIONS: {ANDROID: {}},
  RESULTS: {GRANTED: 'granted'},
}));

import App from '../App';

it('renders the scanner screen', async () => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<App />);
  });
  try {
    const titles = tree.root.findAll(
      n => n.props.children === 'BLE Proximity Scanner',
    );
    expect(titles.length).toBeGreaterThan(0);
  } finally {
    await act(async () => {
      tree.unmount();
    });
  }
});
