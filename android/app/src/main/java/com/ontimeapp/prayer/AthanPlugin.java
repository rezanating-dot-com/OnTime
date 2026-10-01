package com.ontimeapp.prayer;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

@CapacitorPlugin(name = "AthanPlugin")
public class AthanPlugin extends Plugin implements SensorEventListener {

    private MediaPlayer mediaPlayer;
    private SensorManager sensorManager;
    private Sensor accelerometer;
    private Sensor magnetometer;
    private Sensor rotationVector;
    private boolean useRotationVector = false;
    private boolean compassListening = false;
    private float[] gravity = null;
    private float[] geomagnetic = null;
    private final float[] rotationMatrix = new float[9];
    private final float[] remappedMatrix = new float[9];
    private final float[] orientation = new float[3];
    private float declination = 0f;
    private int magAccuracy = SensorManager.SENSOR_STATUS_UNRELIABLE;
    private static final float SENSOR_ALPHA = 0.2f;

    @PluginMethod
    public void startCompass(PluginCall call) {
        if (compassListening) {
            call.resolve();
            return;
        }

        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager == null) {
            call.reject("Sensor service not available");
            return;
        }

        // Compute magnetic declination from user's location
        float lat = call.getFloat("latitude", 0f);
        float lon = call.getFloat("longitude", 0f);
        if (lat != 0f || lon != 0f) {
            GeomagneticField geoField = new GeomagneticField(
                lat, lon, 0f, System.currentTimeMillis());
            declination = geoField.getDeclination();
        }

        gravity = null;
        geomagnetic = null;

        magnetometer = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD);
        if (magnetometer == null) {
            call.reject("Required sensors not available on this device");
            return;
        }

        // Prefer the fused rotation-vector sensor: it's gyro-backed, so hand
        // tremor doesn't read as a heading change the way it does when we
        // derive azimuth from raw accelerometer + magnetometer ourselves.
        rotationVector = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        useRotationVector = rotationVector != null;

        if (useRotationVector) {
            sensorManager.registerListener(this, rotationVector, SensorManager.SENSOR_DELAY_UI);
            // Kept registered so onAccuracyChanged still tracks magAccuracy for
            // the "figure eight" calibration prompt; its readings otherwise
            // aren't used for heading in this mode (see onSensorChanged).
            sensorManager.registerListener(this, magnetometer, SensorManager.SENSOR_DELAY_UI);
        } else {
            accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (accelerometer == null) {
                call.reject("Required sensors not available on this device");
                return;
            }
            sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_UI);
            sensorManager.registerListener(this, magnetometer, SensorManager.SENSOR_DELAY_UI);
        }

        compassListening = true;
        call.resolve();
    }

    @PluginMethod
    public void stopCompass(PluginCall call) {
        stopCompassListener();
        call.resolve();
    }

    private float[] lowPass(float[] input, float[] output) {
        if (output == null) return input.clone();
        for (int i = 0; i < input.length; i++) {
            output[i] = output[i] + SENSOR_ALPHA * (input[i] - output[i]);
        }
        return output;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (useRotationVector) {
            // Magnetometer stays registered only to feed onAccuracyChanged
            // below; recomputing heading from it here would just reintroduce
            // the raw accel+mag jitter this mode exists to avoid.
            if (event.sensor.getType() == Sensor.TYPE_ROTATION_VECTOR) {
                SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
                emitHeading();
            }
            return;
        }

        if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
            gravity = lowPass(event.values, gravity);
            // Wait for a magnetometer sample to notify — accelerometer and
            // magnetometer each fire independently at SENSOR_DELAY_UI, so
            // notifying on both doubled the emit rate and let accelerometer
            // noise (hand tremor) alone trigger a heading update.
            return;
        }

        if (event.sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) {
            geomagnetic = lowPass(event.values, geomagnetic);
            if (gravity == null) return;
            boolean success = SensorManager.getRotationMatrix(
                rotationMatrix, null, gravity, geomagnetic);
            if (success) emitHeading();
        }
    }

    private void emitHeading() {
        // Heading for phone held FLAT (screen up)
        SensorManager.getOrientation(rotationMatrix, orientation);
        float flatAzimuth = (float) Math.toDegrees(orientation[0]);
        float headingFlat = (flatAzimuth + declination + 360) % 360;
        float pitch = (float) Math.toDegrees(orientation[1]);

        // Heading for phone held UPRIGHT (screen facing user)
        SensorManager.remapCoordinateSystem(rotationMatrix,
            SensorManager.AXIS_X, SensorManager.AXIS_Z, remappedMatrix);
        SensorManager.getOrientation(remappedMatrix, orientation);
        float uprightAzimuth = (float) Math.toDegrees(orientation[0]);
        float headingUpright = (uprightAzimuth + declination + 360) % 360;

        JSObject result = new JSObject();
        result.put("headingFlat", (double) headingFlat);
        result.put("headingUpright", (double) headingUpright);
        result.put("pitch", (double) pitch);
        result.put("declination", (double) declination);
        result.put("accuracy", magAccuracy);
        // Use flat heading as default for now
        result.put("heading", (double) headingFlat);
        notifyListeners("compassHeading", result);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        if (sensor.getType() == Sensor.TYPE_MAGNETIC_FIELD) {
            magAccuracy = accuracy;
        }
    }

    private void stopCompassListener() {
        if (compassListening && sensorManager != null) {
            sensorManager.unregisterListener(this);
            compassListening = false;
        }
    }

    @Override
    protected void handleOnDestroy() {
        stopCompassListener();
        stopMediaPlayer();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void createAthanChannel(PluginCall call) {
        String channelId = call.getString("channelId");
        String channelName = call.getString("channelName");
        String soundFilePath = call.getString("soundFilePath");

        if (channelId == null || channelName == null || soundFilePath == null) {
            call.reject("channelId, channelName, and soundFilePath are required");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager)
                    getContext().getSystemService(Context.NOTIFICATION_SERVICE);

            File soundFile = new File(soundFilePath);
            if (!soundFile.exists()) {
                call.reject("Sound file not found: " + soundFilePath);
                return;
            }

            // The process that actually plays a notification sound is SystemUI,
            // which runs under a different uid. Since Android 11 the athans
            // directory under getExternalFilesDir() is app-private, and a file://
            // URI cannot be granted to another app at all — only content:// can
            // be. So hand over a FileProvider URI and grant SystemUI read access,
            // mirroring what Capacitor's own local-notifications plugin does for
            // per-notification sounds.
            Uri soundUri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    soundFile);
            getContext().grantUriPermission(
                    "com.android.systemui",
                    soundUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);

            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();

            NotificationChannel channel = new NotificationChannel(
                    channelId, channelName, NotificationManager.IMPORTANCE_HIGH);
            channel.setSound(soundUri, audioAttributes);
            channel.enableVibration(true);
            channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

            manager.createNotificationChannel(channel);
        }

        call.resolve();
    }

    /**
     * Opens Android's own notification-sound picker, which previews each sound
     * as it is tapped. `existing` marks the sound in use: "default", "silent",
     * or a sound's content URI. Resolves { cancelled: true } when backed out
     * of, otherwise { kind: "default" | "silent" } or
     * { kind: "system", uri, title }.
     */
    @PluginMethod
    public void pickNotificationSound(PluginCall call) {
        String existing = call.getString("existing", "default");
        Uri existingUri;
        if ("default".equals(existing)) {
            existingUri = Settings.System.DEFAULT_NOTIFICATION_URI;
        } else if ("silent".equals(existing)) {
            existingUri = null;
        } else {
            existingUri = Uri.parse(existing);
        }

        Intent intent = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_NOTIFICATION);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Reminder sound");
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, true);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI, Settings.System.DEFAULT_NOTIFICATION_URI);
        intent.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, existingUri);
        startActivityForResult(call, intent, "pickNotificationSoundResult");
    }

    @ActivityCallback
    private void pickNotificationSoundResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Uri picked;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            picked = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI, Uri.class);
        } else {
            picked = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
        }

        ret.put("cancelled", false);
        if (picked == null) {
            // "None" in the picker.
            ret.put("kind", "silent");
        } else if (RingtoneManager.isDefault(picked)) {
            ret.put("kind", "default");
        } else {
            ret.put("kind", "system");
            ret.put("uri", picked.toString());
            ret.put("title", soundTitle(picked));
        }
        call.resolve(ret);
    }

    private String soundTitle(Uri uri) {
        try {
            Ringtone ringtone = RingtoneManager.getRingtone(getContext(), uri);
            if (ringtone != null) {
                String title = ringtone.getTitle(getContext());
                if (title != null && !title.isEmpty()) {
                    return title;
                }
            }
        } catch (Exception ignored) {
            // Fall through to a generic name; the sound itself still works.
        }
        return "Phone sound";
    }

    /**
     * A high-importance channel that plays one of the phone's own sounds.
     * Unlike createAthanChannel there is no file to hand over: a sound from the
     * picker is already a media URI SystemUI can read.
     */
    @PluginMethod
    public void createSoundChannel(PluginCall call) {
        String channelId = call.getString("channelId");
        String channelName = call.getString("channelName");
        String soundUri = call.getString("soundUri");

        if (channelId == null || channelName == null || soundUri == null) {
            call.reject("channelId, channelName, and soundUri are required");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                NotificationManager manager = (NotificationManager)
                        getContext().getSystemService(Context.NOTIFICATION_SERVICE);

                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();

                NotificationChannel channel = new NotificationChannel(
                        channelId, channelName, NotificationManager.IMPORTANCE_HIGH);
                channel.setSound(Uri.parse(soundUri), audioAttributes);
                channel.enableVibration(true);
                channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);

                manager.createNotificationChannel(channel);
            } catch (Exception e) {
                call.reject("Failed to create sound channel: " + e.getMessage());
                return;
            }
        }

        call.resolve();
    }

    @PluginMethod
    public void deleteChannel(PluginCall call) {
        String channelId = call.getString("channelId");

        if (channelId == null) {
            call.reject("channelId is required");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager)
                    getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            manager.deleteNotificationChannel(channelId);
        }

        call.resolve();
    }

    @PluginMethod
    public void playPreview(PluginCall call) {
        String filePath = call.getString("filePath");

        if (filePath == null) {
            call.reject("filePath is required");
            return;
        }

        stopMediaPlayer();

        try {
            File file = new File(filePath);
            if (!file.exists()) {
                call.reject("File not found: " + filePath);
                return;
            }

            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build());
            mediaPlayer.setDataSource(file.getAbsolutePath());
            mediaPlayer.prepare();
            mediaPlayer.setOnCompletionListener(mp -> {
                stopMediaPlayer();
                JSObject result = new JSObject();
                notifyListeners("previewComplete", result);
            });
            mediaPlayer.start();
            call.resolve();
        } catch (Exception e) {
            call.reject("Failed to play preview: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopPreview(PluginCall call) {
        stopMediaPlayer();
        call.resolve();
    }

    @PluginMethod
    public void getExternalFilesDir(PluginCall call) {
        File dir = getContext().getExternalFilesDir(null);
        if (dir == null) {
            call.reject("External files directory not available");
            return;
        }

        JSObject result = new JSObject();
        result.put("path", dir.getAbsolutePath());
        call.resolve(result);
    }

    @PluginMethod
    public void canScheduleExactAlarms(PluginCall call) {
        JSObject result = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            result.put("value", alarmManager.canScheduleExactAlarms());
        } else {
            result.put("value", true);
        }
        call.resolve(result);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("value", pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(result);
    }

    @PluginMethod
    public void requestIgnoreBatteryOptimizations(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    private void stopMediaPlayer() {
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.release();
            } catch (Exception e) {
                // ignore
            }
            mediaPlayer = null;
        }
    }
}
