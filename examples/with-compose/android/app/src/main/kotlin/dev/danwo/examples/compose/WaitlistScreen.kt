package dev.danwo.examples.compose

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** The waitlist screen: an email field, a button, and what the API answered. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun WaitlistScreen() {
    var email by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    var joined by remember { mutableStateOf<WaitlistApi.Joined?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current

    val join: () -> Unit = {
        focus.clearFocus()
        error = null
        joined = null
        sending = true
        scope.launch {
            try {
                joined = WaitlistApi.join(email)
            } catch (refused: WaitlistApi.Refused) {
                error = refused.message
            } finally {
                sending = false
            }
        }
    }

    MaterialTheme {
        Surface(
            // testTagsAsResourceId exposes each testTag as the view's resource id: what getByTestId finds.
            modifier = Modifier
                .fillMaxSize()
                .semantics { testTagsAsResourceId = true },
        ) {
            Column(
                modifier = Modifier
                    .safeDrawingPadding()
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                Text(
                    "LUMEN",
                    style = MaterialTheme.typography.labelMedium,
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.SemiBold,
                )
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "Join the waitlist",
                        style = MaterialTheme.typography.headlineMedium,
                        modifier = Modifier.semantics { heading() },
                    )
                    Text(
                        "Lumen opens to a few teams each week. Leave your work email and we'll write when your seat is ready.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Work email") },
                    placeholder = { Text("you@company.com") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag("email"),
                )
                Button(
                    onClick = join,
                    enabled = !sending,
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 48.dp)
                        .testTag("join"),
                ) {
                    Text(if (sending) "Joining…" else "Join the waitlist")
                }
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("error"))
                }
                joined?.let {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(
                            modifier = Modifier.padding(16.dp),
                            verticalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            Text(
                                "You're on the list",
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.testTag("status"),
                            )
                            if (it.status == "already") {
                                Text("This email had already joined.")
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text("People waiting:", color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("${it.count}", modifier = Modifier.testTag("waitlist-count"))
                            }
                        }
                    }
                }
            }
        }
    }
}
